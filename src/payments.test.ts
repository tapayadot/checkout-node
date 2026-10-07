// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PaymentsApiError, TapayaPayments, TapayaValidationError, TapayaConnectionError, TapayaTimeoutError } from "./index.js";
const result = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  merchantOrderId: "order-1",
  amount: 1200,
  currency: "EUR",
  status: "ready",
  retryAllowed: false,
  clientSecret: `${"a".repeat(32)}_secret_v1_${"b".repeat(43)}`,
};
describe("server payment client", () => {
  it("preserves API diagnostics for embedded requests", async () => {
    const client = new TapayaPayments("merchant-secret", {
      fetch: vi.fn(async () => Response.json({
        message: "Merchant configuration changed. Contact support before retrying.",
        errorCode: "API-0022",
        errors: [{ field: "amount", message: "Invalid amount", code: "range" }],
      }, { status: 409, headers: { "x-request-id": "request-1" } })),
    });
    await expect(client.confirm(result.id, "tok_test")).rejects.toMatchObject({
      name: "PaymentsApiError",
      status: 409,
      message: "Merchant configuration changed. Contact support before retrying.",
      code: "API-0022",
      fieldErrors: [{ field: "amount", message: "Invalid amount", code: "range" }],
      requestId: "request-1",
      headers: expect.any(Headers),
    });
  });
  it.each(["", "<html>Gateway unavailable</html>"])("keeps HTTP status when an error body is not JSON: %j", async (body) => {
    const client = new TapayaPayments("merchant-secret", {
      fetch: vi.fn(async () => new Response(body, { status: 503 })),
    });
    await expect(client.retrieve(result.id)).rejects.toMatchObject({
      name: "PaymentsApiError", status: 503, fieldErrors: [],
    });
  });
  it.each(["successful", "pending", "cancelled"])("reads %s payments after browser access ends", async (status) => {
    const value = { ...result, status, clientSecret: null };
    const client = new TapayaPayments("merchant-secret", {
      fetch: vi.fn(async () => Response.json(value)),
    });
    await expect(client.retrieve(result.id)).resolves.toEqual(value);
    await expect(client.findByOrder(result.merchantOrderId)).resolves.toEqual(value);
    await expect(client.recover(result.id)).resolves.toEqual(value);
  });
  it("uses server authentication and a supplied idempotency key without following redirects", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(result));
    const client = new TapayaPayments("merchant-secret", { fetch: fetcher });
    await client.prepare(
      { merchantOrderId: "order-1", amount: 1200, currency: "EUR" },
      "attempt-1",
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.sandbox.tapaya.com/merchant/payments",
      expect.objectContaining({
        redirect: "error",
        headers: expect.objectContaining({
          authorization: "Bearer merchant-secret",
          "Idempotency-Key": "attempt-1",
        }),
      }),
    );
  });
  it("rejects mismatched identity and unknown statuses", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(result))
      .mockResolvedValueOnce(Response.json({ ...result, status: "unknown" }));
    const client = new TapayaPayments("merchant-secret", { fetch: fetcher });
    await expect(client.retrieve("other")).rejects.toBeInstanceOf(
      PaymentsApiError,
    );
    await expect(client.retrieve(result.id)).rejects.toBeInstanceOf(
      PaymentsApiError,
    );
  });
  it("recovers by order without a received payment ID and treats only 404 as absent", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }));
    const client = new TapayaPayments("merchant-secret", { fetch: fetcher });
    expect(await client.findByOrder("order-1")).toBeNull();
    await expect(client.findByOrder("order-1")).rejects.toBeInstanceOf(
      PaymentsApiError,
    );
  });
  it("requires a client secret on payments and a publishable key in configuration", async () => {
    const { clientSecret: _secret, ...withoutSecret } = result;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(withoutSecret))
      .mockResolvedValueOnce(
        Response.json({ publicKey: "pk_test", merchantId: "m", environment: "development" }),
      )
      .mockResolvedValueOnce(
        Response.json({ publishableKey: `pk_dev_${"c".repeat(32)}`, environment: "development" }),
      );
    const client = new TapayaPayments("merchant-secret", { fetch: fetcher });
    await expect(client.retrieve(result.id)).rejects.toBeInstanceOf(PaymentsApiError);
    await expect(client.configuration()).rejects.toBeInstanceOf(PaymentsApiError);
    expect((await client.configuration()).publishableKey).toBe(`pk_dev_${"c".repeat(32)}`);
  });
});


describe("embedded payment safety", () => {
  it.each([".", "..", "", " ", "a".repeat(201), null, undefined])("rejects unsafe payment ID %j before sending authentication", async (id) => {
    const fetcher = vi.fn();
    const client = new TapayaPayments("merchant-secret", { fetch: fetcher });
    for (const call of [
      () => client.retrieve(id as string),
      () => client.confirm(id as string, "tok_test"),
      () => client.recover(id as string),
      () => client.revokeClientSecret(id as string),
    ]) await expect(call()).rejects.toBeInstanceOf(TapayaValidationError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("validates create fields and order lookups before sending requests", async () => {
    const fetcher = vi.fn();
    const client = new TapayaPayments("merchant-secret", { fetch: fetcher });
    await expect(client.prepare({ merchantOrderId: "a".repeat(201), amount: 1, currency: "EUR" }, "key")).rejects.toMatchObject({
      name: "TapayaValidationError", fieldErrors: [expect.objectContaining({ field: "merchantOrderId" })],
    });
    await expect(client.prepare({ merchantOrderId: "order", amount: 1, currency: "EUR", customer: { email: 42 as unknown as string } }, "key")).rejects.toMatchObject({
      fieldErrors: [expect.objectContaining({ field: "customer.email" })],
    });
    await expect(client.findByOrder("")).rejects.toBeInstanceOf(TapayaValidationError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts omitted and null customer fields from the backend contract", async () => {
    const fetcher = vi.fn(async () => Response.json(result));
    const client = new TapayaPayments("merchant-secret", { fetch: fetcher });
    await client.prepare({ merchantOrderId: "order-1", amount: 1200, currency: "EUR", customer: { email: null, billingAddress: { line1: null, country: "CZ" }, shippingAddress: null } }, "key");
    const request = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(request[1].body as string).customer).toEqual({ email: null, billingAddress: { line1: null, country: "CZ" }, shippingAddress: null });
  });

  it("retains real status and request ID when a successful HTTP response is malformed", async () => {
    const client = new TapayaPayments("merchant-secret", {
      fetch: vi.fn(async () => new Response("not-json", { status: 200, headers: { "x-request-id": "bad-response" } })),
    });
    await expect(client.retrieve(result.id)).rejects.toMatchObject({ status: 200, requestId: "bad-response" });
  });

  it("revokes browser access through the merchant endpoint and accepts its empty 204", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new TapayaPayments("merchant-secret", { fetch: fetcher });
    await expect(client.revokeClientSecret(result.id)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(`https://api.sandbox.tapaya.com/merchant/payments/${result.id}/revoke-client-secret`, expect.objectContaining({ method: "POST", cache: "no-store" }));
  });

  it("preserves caller cancellation and does not send an already aborted request", async () => {
    const fetcher = vi.fn();
    const client = new TapayaPayments("merchant-secret", { fetch: fetcher });
    const controller = new AbortController();
    const reason = new Error("caller stopped checkout");
    controller.abort(reason);
    await expect(client.confirm(result.id, "tok_test", { signal: controller.signal })).rejects.toBe(reason);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("cancels an in-flight request without retrying", async () => {
    const controller = new AbortController();
    const reason = new Error("caller stopped checkout");
    const fetcher = vi.fn(async (_input: unknown, init?: RequestInit): Promise<Response> => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        controller.abort(reason);
      });
    });
    const client = new TapayaPayments("merchant-secret", { fetch: fetcher });
    await expect(client.confirm(result.id, "tok_test", { signal: controller.signal })).rejects.toBe(reason);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports request timeouts and connection failures without retrying charges", async () => {
    const fetcher = vi.fn(async (_input: unknown, init?: RequestInit): Promise<Response> => {
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
    });
    const client = new TapayaPayments("merchant-secret", { fetch: fetcher });
    await expect(client.confirm(result.id, "tok_test", { timeoutMs: 10 })).rejects.toBeInstanceOf(TapayaTimeoutError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const offlineFetch = vi.fn().mockRejectedValue(new TypeError("offline"));
    const offline = new TapayaPayments("merchant-secret", { fetch: offlineFetch });
    await expect(offline.confirm(result.id, "tok_test")).rejects.toBeInstanceOf(TapayaConnectionError);
    expect(offlineFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid timeout values before submitting a request", async () => {
    const fetcher = vi.fn();
    const client = new TapayaPayments("merchant-secret", { fetch: fetcher });
    await expect(client.confirm(result.id, "tok_test", { timeoutMs: 0 })).rejects.toMatchObject({
      name: "TapayaValidationError", fieldErrors: [{ field: "timeoutMs", message: "Invalid timeoutMs" }],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects loopback HTTP URLs in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => new TapayaPayments("merchant-secret", { baseUrl: "http://localhost:5000" })).toThrow();
    } finally { vi.unstubAllEnvs(); }
  });
});


describe("backend payment identity", () => {
  it.each([
    "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}",
    " aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa ",
  ])("accepts backend-normalized Guid identity for %s", async (id) => {
    const client = new TapayaPayments("merchant-secret", { fetch: vi.fn(async () => Response.json(result)) });
    await expect(client.retrieve(id)).resolves.toEqual(result);
    await expect(client.confirm(id, "tok_test")).resolves.toEqual(result);
    await expect(client.recover(id)).resolves.toEqual(result);
  });

  it("keeps exact comparison for non-Guid identities", async () => {
    const client = new TapayaPayments("merchant-secret", {
      fetch: vi.fn(async () => Response.json({ ...result, id: "payment-fixture", clientSecret: null })),
    });
    await expect(client.retrieve("payment-fixture")).resolves.toMatchObject({ id: "payment-fixture" });
    await expect(client.retrieve("PAYMENT-FIXTURE")).rejects.toBeInstanceOf(PaymentsApiError);
  });

  it.each([
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_secret_legacy",
    `${"c".repeat(32)}_secret_v1_${"b".repeat(43)}`,
    `${"a".repeat(32)}_secret_v1_${"b".repeat(42)}`,
  ])("rejects malformed or mismatched browser credentials", async (clientSecret) => {
    const client = new TapayaPayments("merchant-secret", { fetch: vi.fn(async () => Response.json({ ...result, clientSecret })) });
    await expect(client.retrieve(result.id)).rejects.toBeInstanceOf(PaymentsApiError);
  });
});
