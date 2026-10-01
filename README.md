# Tapaya Checkout SDK

Server-side TypeScript SDK for [Tapaya Hosted Checkout](https://docs.tapaya.com/online/integration/hosted_checkout).
Create a Checkout session for an order, redirect the customer to the Tapaya-hosted payment page, and verify the
payment on your server before fulfilling the order.

Requires Node.js 22.13 or newer. The SDK uses only standard Web APIs (`fetch`, Web Crypto, and `AbortSignal`) and
does not import Node.js modules.

```sh
npm install @tapayadot/checkout
```

## Quick start

Copy a **Secret key** from the [API Keys page](https://platform.tapaya.com/api-keys/) and store it in your server
environment. Never expose it to browser code.

```sh
TAPAYA_SECRET_KEY=your-secret-key
```

Create the client in server-only code:

```ts
import { Tapaya } from '@tapayadot/checkout'

const tapaya = new Tapaya(process.env.TAPAYA_SECRET_KEY)
```

When the customer checks out, persist the order with a unique attempt key, then create a session. Amounts are
integers in minor units, so `12100` is EUR 121.00.

```ts
const session = await tapaya.checkout.sessions.create(
  {
    merchantOrderId: order.id,
    amount: order.totalInMinorUnits,
    currency: order.currency,
    successUrl: 'https://shop.example/checkout/return',
    cancelUrl: 'https://shop.example/checkout/cancel',
  },
  { idempotencyKey: order.checkoutAttemptKey },
)

// Save session.id with the order, then redirect with the URL exactly as returned.
return Response.redirect(session.url, 303)
```

When the customer returns to your success or cancel URL, retrieve the session and compare it with the stored order.
A redirect alone never proves payment.

```ts
const current = await tapaya.checkout.sessions.retrieve(order.checkoutSessionId)

const matches =
  current.merchantOrderId === order.id &&
  current.amount === order.totalInMinorUnits &&
  current.currency === order.currency

if (matches && current.paymentStatus === 'successful') {
  await fulfillOnce(order)
}
```

Customers can close the tab before they return, so also check unresolved sessions from a background job. The
[Quick Start Guide](https://docs.tapaya.com/online/getting-started/quick_start_guide) covers Checkout settings,
return URLs, and test cards.

## Configuration

```ts
const tapaya = new Tapaya(apiKey, {
  environment: 'sandbox',
  timeoutMs: 30_000,
  maxRetries: 2,
})
```

| Option | Default | Description |
|---|---|---|
| `apiKey` (first argument) | `TAPAYA_SECRET_KEY` | Your Secret key. |
| `environment` | `TAPAYA_ENVIRONMENT`, then `sandbox` | `sandbox` (`https://api.sandbox.tapaya.com`) or `production` (`https://api.tapaya.com`). |
| `baseUrl` | Set by `environment` | Overrides the API URL, for example with the URL supplied for your deployment. |
| `timeoutMs` | `30000` | Timeout for each attempt, in milliseconds. |
| `maxRetries` | `2` | Retries after a network error, a timeout, HTTP 429, 502, 503, or 504, or a create still in progress. |
| `fetch` | Global `fetch` | Custom `fetch` implementation, for example to add a proxy or instrumentation. |

The client resolves the API key and API environment once, when it is constructed. Use a key that matches the
selected environment. API, return, and hosted checkout URLs must use HTTPS, except that HTTP is allowed for
`localhost`, `127.0.0.1`, and `[::1]` outside `NODE_ENV=production`. The SDK checks the current `NODE_ENV` each
time it validates a local HTTP URL.

Each method also accepts `signal`, `timeoutMs`, and `maxRetries` for a single request:

```ts
const current = await tapaya.checkout.sessions.retrieve(sessionId, {
  signal: request.signal,
  timeoutMs: 5_000,
})
```

When the signal aborts, the method stops immediately, without retrying, and rejects with the signal's reason.

## Checkout sessions

### Create a session

`tapaya.checkout.sessions.create(params, options?)` requires `amount` and `currency`. `amount` is the final total,
including tax and shipping, an integer between 1 and 2,147,483,647 minor units. `currency` is a three-letter ISO 4217
code. Tapaya stores and returns it uppercase.

Optional fields:

| Field | Description |
|---|---|
| `merchantOrderId` | Your order reference. Tapaya generates one if you omit it. |
| `locale` | Language of the hosted page, such as `en`. Defaults to `en`. |
| `successUrl`, `cancelUrl` | Return URLs. Default to the URLs in your Checkout settings. |
| `tax`, `shipping` | Tax and shipping included in `amount`, in minor units. |
| `taxRate` | Single tax rate in percentage points, such as `21`. |
| `taxBreakdown` | Tax per rate, `[{ taxRate, tax }]`, for orders with mixed rates. Use instead of `taxRate`: the types reject both together. |
| `items` | Products shown on the hosted page: `reference`, `name`, `description`, `imageUrl`, `quantity`, and `unitAmount`. Items are for display only and do not change the amount charged. |
| `customer` | Optional `email`, `billingAddress`, and `shippingAddress`. Send only the details you collect. |

Before sending, the SDK checks types, required fields, integer amounts, the currency format, and a maximum email
length of 254 characters. Return URLs must be absolute HTTPS URLs, with the local HTTP exception described under
[Configuration](#configuration). Tapaya validates business rules such as email format, address limits, and country
codes, and reports problems as `TapayaInvalidRequestError`. See
[Checkout Sessions](https://docs.tapaya.com/online/integration/api_integration#checkout-sessions) for field rules,
tax totals, and customer address limits.

### Retrieve a session

`tapaya.checkout.sessions.retrieve(id, options?)` returns the current state of a session.

Both methods return a `CheckoutSession`:

| Field | Description |
|---|---|
| `id` | Session ID, such as `cs_Y7u2d`. |
| `url` | Hosted payment page. Redirect to it unchanged. |
| `merchantOrderId`, `amount`, `currency` | Order details to compare with your stored order. |
| `status` | `open`, `completed`, or `expired`. Sessions expire after 30 minutes. New values may be added. |
| `paymentStatus` | `unpaid`, `successful`, `failed`, `cancelled`, `refunded`, or `action_needed`. New values may be added. |
| `paymentReference` | Token of the latest payment attempt, or `null` before the first attempt. |
| `tax`, `shipping`, `taxRate`, `taxBreakdown` | Totals sent when the session was created. Default to `0`, `0`, `null`, and `[]`. |
| `items` | Items sent when the session was created, or an empty array. |
| `createdAt`, `expiresAt`, `completedAt` | ISO 8601 timestamps. `completedAt` is `null` until payment succeeds. |

Handle unknown `status` and `paymentStatus` values, for example by treating them as not yet paid. Only
`paymentStatus: 'successful'` proves payment.

A declined card is a payment outcome, not an error. The session stays `open` with `paymentStatus: 'failed'`, and
the customer can try again.

## Idempotency and retries

Every create request sends an `Idempotency-Key`. If you omit `idempotencyKey`, the SDK generates a random key for
each call. Within that call, retries reuse the key, so a retry never creates a second session.

To stay safe across separate calls and process restarts, store a key with the order and pass it every time you
create a session for that attempt, with the same parameters. Tapaya returns the original session instead of
creating a new one. Use a new key only for a new checkout attempt, never to retry an uncertain result.

A repeated create returns the original response, including its original payment status. Call
`tapaya.checkout.sessions.retrieve(session.id)` to get the current status before fulfilling the order.

The SDK retries both methods after network errors, timeouts, and HTTP 429, 502, 503, and 504. It also retries a
create that fails with HTTP 409 `API-0024`, which means an earlier request with the same key is still being
processed. Retries send the same key and body, so they return the original session once it is ready. The SDK
waits between attempts with exponential backoff and jitter, and honors `Retry-After` up to 10 seconds. When Tapaya
asks for a longer wait, the SDK stops retrying and throws the error for that HTTP status: `TapayaRateLimitError`
for 429, `TapayaServerError` for 502, 503, or 504, or `TapayaConflictError` for 409. Only `TapayaRateLimitError`
exposes the requested delay as `retryAfterMs`; other HTTP errors retain the `Retry-After` header in `headers`.
All retries share the `maxRetries` budget. Set `maxRetries: 0` to turn retries off.

If a create still fails with `API-0024` after retries, wait and retry with the same key and parameters. If the
conflict persists, stop retrying and contact Tapaya support with the idempotency key, the request time, and the
order reference. Never switch to a new key to get past the conflict: the original request may already have created
a session, and a new key can create a second one.

## Errors

Every error the SDK throws extends `TapayaError`, except an aborted request, which rejects with the signal's reason.

| Error | When |
|---|---|
| `TapayaValidationError` | Parameters failed validation before a request was sent. |
| `TapayaAuthenticationError` | HTTP 401: the Secret key is missing, invalid, or not matched to an active merchant. |
| `TapayaInvalidRequestError` | HTTP 400 or 422: Tapaya rejected the parameters. |
| `TapayaPermissionError` | HTTP 403. |
| `TapayaNotFoundError` | HTTP 404: the session does not exist for this merchant. |
| `TapayaConflictError` | HTTP 409. `code` is `API-0022` when the `merchantOrderId` already exists, `API-0024` when a request with the same idempotency key is still in progress and retries are exhausted or skipped (see [Idempotency and retries](#idempotency-and-retries)), or `API-0025` when the idempotency key was already used with different parameters. |
| `TapayaRateLimitError` | HTTP 429 after retries, or right away when `Retry-After` is longer than 10 seconds. `retryAfterMs` holds the requested delay, when Tapaya sends one. |
| `TapayaServerError` | HTTP 5xx. Only 502, 503, and 504 are retried, unless retries are disabled or `Retry-After` exceeds 10 seconds. Other 5xx statuses fail immediately. |
| `TapayaApiError` | Base class of the HTTP errors above, and any other HTTP error status. |
| `TapayaConnectionError` | The request failed or the response was lost after retries. The original error is in `cause`. |
| `TapayaTimeoutError` | A `TapayaConnectionError` for an attempt that exceeded `timeoutMs`. |
| `TapayaResponseError` | Tapaya returned a response the SDK could not read. |

HTTP errors carry `status`, the Tapaya error `code`, `fieldErrors` (`{ field, message, code? }[]`), the
response `headers`, and `requestId` from the `X-Request-Id` header, when present. The backend does not currently
set this header. Include the session ID or order reference and the request time in support requests, along with
`requestId` if available. `TapayaResponseError` carries `status`, `headers`, and `requestId` too.
`TapayaValidationError` carries `fieldErrors` too, with `field` set to the parameter path, such as `customer.email`.

```ts
import { TapayaConnectionError, TapayaError, TapayaValidationError } from '@tapayadot/checkout'

try {
  const session = await tapaya.checkout.sessions.create(params, { idempotencyKey })
  return Response.redirect(session.url, 303)
} catch (error) {
  if (error instanceof TapayaValidationError) {
    console.error(error.fieldErrors)
  } else if (error instanceof TapayaConnectionError) {
    // The outcome is unknown. Retry later with the same idempotency key.
  } else if (error instanceof TapayaError) {
    console.error(error.message)
  }
  throw error
}
```

## More information

- [Online Payments](https://docs.tapaya.com/online): overview and guides
- [API Integration](https://docs.tapaya.com/online/integration/api_integration): request fields, payment states, and
  idempotency rules
- [Checkout Security](https://docs.tapaya.com/online/security/checkout_security): key handling and payment
  verification
- Questions and feature requests: [developers@tapaya.com](mailto:developers@tapaya.com)

## License

[Apache-2.0](LICENSE)
