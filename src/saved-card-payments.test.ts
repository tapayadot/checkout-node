import { describe, expect, it, vi } from 'vitest'
import { Tapaya, TapayaConflictError, TapayaResponseError, TapayaValidationError } from './index.js'

const id = '0b3c7f0e-1d2a-4c5b-8e9f-0a1b2c3d4e5f'
const secret = `${id.replaceAll('-', '')}_secret_v1_${'a'.repeat(43)}`
const payment = {
  id, merchantOrderId: 'order-7', status: 'action_required', amount: 2500, currency: 'EUR', retryAllowed: false,
  clientSecret: secret, paymentMethodId: 'pm_example', initiator: 'customer', merchantInitiatedReason: null,
  captureMethod: 'automatic', amountAuthorized: 0, amountCaptured: 0, amountRefunded: 0, authorizationExpiresAt: null,
  nextAction: { type: 'three_d_secure', url: 'https://checkout.sandbox.tapaya.com/a/abc', expiresAt: '2026-10-23T10:15:00Z' },
  declineReason: null, createdAt: '2026-10-23T10:00:00Z',
}
const refund = { id: 'rf_1', paymentId: id, amount: 500, currency: 'EUR', status: 'succeeded', reason: 'requested_by_customer', createdAt: payment.createdAt }
const customer = { merchantOrderId: 'order-7', amount: 2500, currency: 'EUR', paymentMethodId: 'pm_example', initiator: 'customer', returnUrl: 'https://shop.example/return' } as const

function client(...bodies: { status?: number, body: unknown }[]) {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const next = bodies.length > 1 ? bodies.shift()! : bodies[0]
    return Response.json(next.body, { status: next.status ?? 200 })
  })
  return { api: new Tapaya('tapaya_test_secret', { baseUrl: 'https://api.sandbox.tapaya.com', fetch: fetcher, maxRetries: 1 }), fetcher }
}
const sent = (fetcher: ReturnType<typeof client>['fetcher'], call = 0) => {
  const [url, init] = fetcher.mock.calls[call]
  return { url: String(url), method: init!.method, headers: new Headers(init!.headers), body: init!.body ? JSON.parse(init!.body as string) : undefined }
}

describe('saved card payments', () => {
  it('creates a customer-initiated payment with its idempotency key and returns the next action and client secret', async () => {
    const { api, fetcher } = client({ body: payment })
    const created = await api.payments.create(customer, { idempotencyKey: 'order-7:buy' })
    expect(created).toEqual(payment)
    const request = sent(fetcher)
    expect(request).toMatchObject({ url: 'https://api.sandbox.tapaya.com/merchant/payments', method: 'POST', body: customer })
    expect(request.headers.get('idempotency-key')).toBe('order-7:buy')
    expect(request.headers.get('authorization')).toBe('Bearer tapaya_test_secret')
  })

  it('fills fields older responses omit and accepts merchant-initiated payments without a browser credential', async () => {
    const { api } = client({ body: { id, merchantOrderId: 'sub-1', status: 'successful', amount: 990, currency: 'EUR', retryAllowed: false, clientSecret: null, createdAt: payment.createdAt } })
    const created = await api.payments.create({ merchantOrderId: 'sub-1', amount: 990, currency: 'EUR', paymentMethodId: 'pm_example', initiator: 'merchant', merchantInitiatedReason: 'recurring' })
    expect(created).toMatchObject({ status: 'successful', clientSecret: null, nextAction: null, captureMethod: 'automatic', declineReason: null })
  })

  it.each([
    [{ ...customer, returnUrl: undefined }, 'returnUrl'],
    [{ ...customer, merchantInitiatedReason: 'recurring' }, 'merchantInitiatedReason'],
    [{ ...customer, initiator: 'merchant', returnUrl: undefined }, 'merchantInitiatedReason'],
    [{ ...customer, allowIncrementalAuthorization: true }, 'allowIncrementalAuthorization'],
    [{ ...customer, currency: 'eur' }, 'currency'],
    [{ ...customer, returnUrl: 'javascript:alert(1)' }, 'returnUrl'],
    [{ ...customer, surprise: true }, ''],
  ])('rejects invalid parameters before sending a request (%#)', async (params, field) => {
    const { api, fetcher } = client({ body: payment })
    const error = await api.payments.create(params as never).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(TapayaValidationError)
    if (field) expect((error as TapayaValidationError).fieldErrors.map((issue) => issue.field)).toContain(field)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('refuses a response for another order, payment or client secret', async () => {
    await expect(client({ body: { ...payment, amount: 1 } }).api.payments.create(customer)).rejects.toBeInstanceOf(TapayaResponseError)
    await expect(client({ body: { ...payment, id: '1b3c7f0e-1d2a-4c5b-8e9f-0a1b2c3d4e5f' } }).api.payments.get(id)).rejects.toBeInstanceOf(TapayaResponseError)
    await expect(client({ body: { ...payment, clientSecret: `${'f'.repeat(32)}_secret_v1_x` } }).api.payments.get(id)).rejects.toBeInstanceOf(TapayaResponseError)
    await expect(client({ body: { ...payment, status: 'surprise' } }).api.payments.get(id)).rejects.toBeInstanceOf(TapayaResponseError)
  })

  it('captures, increments and cancels with idempotency keys', async () => {
    const authorized = { ...payment, status: 'authorized', clientSecret: null, nextAction: null, captureMethod: 'manual' }
    const { api, fetcher } = client({ body: authorized })
    await api.payments.capture(id, { amount: 1800 }, { idempotencyKey: 'cap-1' })
    await api.payments.increment(id, { amount: 500 }, { idempotencyKey: 'inc-1' })
    await api.payments.cancel(id, { idempotencyKey: 'void-1' })
    expect([0, 1, 2].map((call) => {
      const request = sent(fetcher, call)
      return [request.url.replace('https://api.sandbox.tapaya.com', ''), request.headers.get('idempotency-key'), request.body]
    })).toEqual([
      [`/merchant/payments/${id}/capture`, 'cap-1', { amount: 1800 }],
      [`/merchant/payments/${id}/increment`, 'inc-1', { amount: 500 }],
      [`/merchant/payments/${id}/cancel`, 'void-1', undefined],
    ])
    await expect(api.payments.increment(id, {} as never)).rejects.toBeInstanceOf(TapayaValidationError)
    await expect(api.payments.capture(id, {}, { idempotencyKey: 'has space' })).rejects.toBeInstanceOf(TapayaValidationError)
  })

  it('creates, lists and reads refunds', async () => {
    const { api, fetcher } = client({ body: refund }, { body: { data: [refund] } }, { body: refund })
    expect(await api.payments.refunds.create(id, { amount: 500 }, { idempotencyKey: 'rf-1' })).toEqual(refund)
    expect(await api.payments.refunds.list(id)).toEqual([refund])
    expect(await api.payments.refunds.get(id, 'rf_1')).toEqual(refund)
    expect(sent(fetcher, 0)).toMatchObject({ url: `https://api.sandbox.tapaya.com/merchant/payments/${id}/refunds`, body: { amount: 500 } })
    expect(sent(fetcher, 2).url).toBe(`https://api.sandbox.tapaya.com/merchant/payments/${id}/refunds/rf_1`)
    await expect(api.payments.refunds.create(id, { reason: 'whim' } as never)).rejects.toBeInstanceOf(TapayaValidationError)
  })

  it('surfaces conflicts such as a used saved card', async () => {
    const { api } = client({ status: 409, body: { message: 'The saved card has expired.' } })
    await expect(api.payments.create(customer)).rejects.toBeInstanceOf(TapayaConflictError)
  })
})
