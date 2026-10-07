import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { Tapaya, TapayaConnectionError, TapayaOrderMismatchError, TapayaValidationError } from './index.js'
import type {
  CheckoutSession, CreateCheckoutSessionParams, CreateEmbeddedSessionOptions,
  EmbeddedCheckoutSession, HostedCheckoutSession, RetrieveEmbeddedSessionOptions,
} from './index.js'

const order = { merchantOrderId: 'order-1', amount: 1200, currency: 'EUR' }
const payment = {
  ...order,
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  status: 'ready',
  retryAllowed: false,
  clientSecret: `${'a'.repeat(32)}_secret_v1_${'b'.repeat(43)}`,
}
const hosted = {
  ...order,
  id: 'cs_123',
  url: 'https://checkout.tapaya.com/c/cs_123',
  status: 'open',
  paymentStatus: 'unpaid',
  createdAt: '2026-10-05T12:00:00Z',
  expiresAt: '2026-10-05T12:30:00Z',
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('checkout modes', () => {
  it('uses one organization secret with merchant selectors in both checkout modes', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(hosted))
      .mockResolvedValueOnce(Response.json(payment))
      .mockResolvedValueOnce(Response.json(hosted))
    const sessions = new Tapaya('organization-secret', {
      fetch: fetcher, merchantToken: 'first-merchant', environment: 'sandbox',
    }).checkout.sessions
    await sessions.create(order)
    await sessions.create({ ...order, mode: 'embedded' }, { merchantToken: 'second-merchant' })
    await sessions.retrieve(hosted.id, { merchantToken: 'third-merchant' })
    expect(fetcher.mock.calls.map(([, init]) => init.headers['X-Tapaya-Merchant-Token'])).toEqual([
      'first-merchant', 'second-merchant', 'third-merchant',
    ])
    for (const [, init] of fetcher.mock.calls) {
      expect(init.headers.authorization).toBe('Bearer organization-secret')
      if (init.body) expect(JSON.parse(init.body)).not.toHaveProperty('merchantToken')
    }
  })

  it.each(['', ' ', 'x'.repeat(129), 'merchant\r\nheader'])('rejects invalid merchant selectors before fetching', async (merchantToken) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(hosted))
    expect(() => new Tapaya('secret', { fetch: fetcher, merchantToken })).toThrow('Invalid merchantToken')
    const sessions = new Tapaya('secret', { fetch: fetcher }).checkout.sessions
    await expect(sessions.create(order, { merchantToken })).rejects.toThrow('Invalid merchantToken')
    await expect(sessions.create({ ...order, mode: 'embedded' }, { merchantToken })).rejects.toThrow('Invalid merchantToken')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('routes both modes through one client without sending SDK selectors to the API', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(hosted))
      .mockResolvedValueOnce(Response.json(payment))
    const tapaya = new Tapaya('secret', { fetch: fetcher, environment: 'sandbox' })
    const redirect = await tapaya.checkout.sessions.create({ ...order, mode: 'hosted' })
    const embedded = await tapaya.checkout.sessions.create({ ...order, mode: 'embedded' }, { idempotencyKey: 'attempt-1' })
    expectTypeOf(redirect).toEqualTypeOf<HostedCheckoutSession>()
    expectTypeOf(embedded).toEqualTypeOf<EmbeddedCheckoutSession>()
    expect(redirect).toMatchObject({ mode: 'hosted', url: hosted.url })
    expect(embedded).toEqual({
      ...order, id: payment.id, mode: 'embedded', url: null,
      status: 'open', paymentStatus: 'unpaid', retryAllowed: false, clientSecret: payment.clientSecret,
    })
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://api.sandbox.tapaya.com/merchant/checkout-sessions',
      'https://api.sandbox.tapaya.com/merchant/payments',
    ])
    for (const [, init] of fetcher.mock.calls) {
      expect(JSON.parse(init.body)).toEqual(order)
      expect(init.headers.authorization).toBe('Bearer secret')
    }
    expect(fetcher.mock.calls[1][1].headers['Idempotency-Key']).toBe('attempt-1')
  })

  it.each(['option', 'environment variable'])('rejects embedded production calls selected by %s', async (source) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(hosted))
    if (source === 'environment variable') vi.stubEnv('TAPAYA_ENVIRONMENT', 'production')
    const tapaya = new Tapaya('secret', { fetch: fetcher, ...(source === 'option' ? { environment: 'production' as const } : {}) })
    await expect(tapaya.checkout.sessions.create({ ...order, mode: 'embedded' })).rejects.toThrow('not available in production')
    expect(fetcher).not.toHaveBeenCalled()
    await tapaya.checkout.sessions.create(order)
    expect(fetcher.mock.calls[0][0]).toBe('https://api.tapaya.com/merchant/checkout-sessions')
  })

  it('retrieves each mode explicitly and preserves get as an alias', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(hosted))
      .mockResolvedValueOnce(Response.json(payment))
      .mockResolvedValueOnce(Response.json(payment))
    const sessions = new Tapaya('secret', { fetch: fetcher }).checkout.sessions
    expect((await sessions.retrieve(hosted.id)).mode).toBe('hosted')
    const embedded = await sessions.retrieve(payment.id, { mode: 'embedded' })
    expectTypeOf(embedded).toEqualTypeOf<EmbeddedCheckoutSession>()
    expect(await sessions.get(payment.id, { mode: 'embedded' })).toEqual(embedded)
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `https://api.sandbox.tapaya.com/merchant/checkout-sessions/${hosted.id}`,
      `https://api.sandbox.tapaya.com/merchant/payments/${payment.id}`,
      `https://api.sandbox.tapaya.com/merchant/payments/${payment.id}`,
    ])
  })

  it.each([
    ['ready', 'open', 'unpaid'],
    ['successful', 'completed', 'successful'],
    ['declined', 'open', 'failed', true],
    ['declined', 'ended', 'failed'],
    ['pending', 'open', 'pending'],
    ['action_required', 'open', 'action_needed'],
    ['cancelled', 'ended', 'cancelled'],
  ])('maps %s without treating a missing browser secret as cancellation', async (status, sessionStatus, paymentStatus, retryAllowed = false) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...payment, status, retryAllowed, clientSecret: null }))
    const sessions = new Tapaya('secret', { fetch: fetcher }).checkout.sessions
    expect(await sessions.retrieve(payment.id, { mode: 'embedded' })).toMatchObject({
      status: sessionStatus, paymentStatus, clientSecret: null,
    })
  })

  it('prepares the first attempt and reuses it on later calls', async () => {
    const notFound = () => Response.json({ code: 'API-0404', message: 'Not found' }, { status: 404 })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(Response.json(payment))
      .mockResolvedValueOnce(Response.json({ ...payment, status: 'pending' }))
    const sessions = new Tapaya('secret', { fetch: fetcher }).checkout.sessions
    expect(await sessions.prepare(order)).toMatchObject({ id: payment.id, status: 'open', clientSecret: payment.clientSecret })
    expect(fetcher.mock.calls[1][1].headers['Idempotency-Key']).toBe('order-1:initial')
    expect(await sessions.prepare(order)).toMatchObject({ id: payment.id, paymentStatus: 'pending' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('prepares the next attempt only after a decline that allows a retry', async () => {
    const next = { ...payment, id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', clientSecret: `${'b'.repeat(32)}_secret_v1_${'c'.repeat(43)}` }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ ...payment, status: 'declined', retryAllowed: true }))
      .mockResolvedValueOnce(Response.json(next))
      .mockResolvedValueOnce(Response.json({ ...next, status: 'declined', retryAllowed: false }))
    const sessions = new Tapaya('secret', { fetch: fetcher }).checkout.sessions
    expect(await sessions.prepare(order)).toMatchObject({ id: next.id, status: 'open' })
    expect(fetcher.mock.calls[1][1].headers['Idempotency-Key']).toBe(`order-1:after:${payment.id}`)
    expect(await sessions.prepare(order)).toMatchObject({ id: next.id, status: 'ended', paymentStatus: 'failed' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('prepares the next attempt after an unsubmitted attempt was cancelled', async () => {
    const next = { ...payment, id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', clientSecret: `${'b'.repeat(32)}_secret_v1_${'c'.repeat(43)}` }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ ...payment, status: 'cancelled', retryAllowed: true, clientSecret: null }))
      .mockResolvedValueOnce(Response.json(next))
    const sessions = new Tapaya('secret', { fetch: fetcher }).checkout.sessions
    expect(await sessions.prepare(order)).toMatchObject({ id: next.id, status: 'open' })
    expect(fetcher.mock.calls[1][1].headers['Idempotency-Key']).toBe(`order-1:after:${payment.id}`)
  })

  it.each(['order 1', 'objednávka-1', '注文'.repeat(100)])('prepares %s with a stable header-safe key', async (merchantOrderId) => {
    const fetcher = vi.fn().mockImplementation(async (_url, init) => init.method === 'GET'
      ? new Response(null, { status: 404 })
      : Response.json({ ...payment, merchantOrderId }))
    const sessions = new Tapaya('secret', { fetch: fetcher }).checkout.sessions
    await sessions.prepare({ ...order, merchantOrderId })
    await sessions.prepare({ ...order, merchantOrderId })
    const keys = fetcher.mock.calls.filter(([, init]) => init.method === 'POST').map(([, init]) => init.headers['Idempotency-Key'])
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatch(/^[\x21-\x7e]{1,255}$/)
    expect(keys[1]).toBe(keys[0])
  })

  it('verifies the order and rejects a session that does not match it', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 'API-0404', message: 'Not found' }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ ...payment, status: 'successful' }))
      .mockImplementation(async () => Response.json({ ...payment, amount: 999 }))
    const sessions = new Tapaya('secret', { fetch: fetcher }).checkout.sessions
    expect(await sessions.verify(order)).toBeNull()
    expect(await sessions.verify(order)).toMatchObject({ status: 'completed' })
    await expect(sessions.verify(order)).rejects.toMatchObject({ name: 'TapayaOrderMismatchError', sessionId: payment.id })
    await expect(sessions.prepare(order)).rejects.toBeInstanceOf(TapayaOrderMismatchError)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('supports configuration, order recovery, confirmation, and revocation', async () => {
    const configuration = { publishableKey: `pk_dev_${'c'.repeat(32)}`, environment: 'development' }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(configuration))
      .mockResolvedValueOnce(Response.json(payment))
      .mockResolvedValueOnce(Response.json({ ...payment, status: 'successful', clientSecret: null }))
      .mockResolvedValueOnce(Response.json({ ...payment, status: 'pending' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    const tapaya = new Tapaya('secret', { fetch: fetcher })
    const sessions = tapaya.checkout.sessions
    expect(await tapaya.checkout.configuration()).toEqual({ ...configuration, apiOrigin: 'https://api.sandbox.tapaya.com' })
    expect(await sessions.findByOrder(order.merchantOrderId)).toMatchObject({ mode: 'embedded', paymentStatus: 'unpaid' })
    expect(await sessions.confirm(payment.id, 'tok_test')).toMatchObject({ status: 'completed', paymentStatus: 'successful' })
    expect(await sessions.recover(payment.id)).toMatchObject({ status: 'open', paymentStatus: 'pending' })
    await expect(sessions.revokeClientSecret(payment.id)).resolves.toBeUndefined()
    expect(await sessions.findByOrder(order.merchantOrderId)).toBeNull()
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ token: 'tok_test', paymentMethod: 'card' })
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://api.sandbox.tapaya.com/merchant/payments/configuration',
      'https://api.sandbox.tapaya.com/merchant/payments?merchantOrderId=order-1',
      `https://api.sandbox.tapaya.com/merchant/payments/${payment.id}/confirm`,
      `https://api.sandbox.tapaya.com/merchant/payments/${payment.id}/recover`,
      `https://api.sandbox.tapaya.com/merchant/payments/${payment.id}/revoke-client-secret`,
      'https://api.sandbox.tapaya.com/merchant/payments?merchantOrderId=order-1',
    ])
  })

  it('does not inherit hosted retries for creation, retrieval, or confirmation', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('offline'))
    const sessions = new Tapaya('secret', { fetch: fetcher, maxRetries: 5 }).checkout.sessions
    await expect(sessions.create({ ...order, mode: 'embedded' })).rejects.toBeInstanceOf(TapayaConnectionError)
    await expect(sessions.retrieve(payment.id, { mode: 'embedded' })).rejects.toBeInstanceOf(TapayaConnectionError)
    await expect(sessions.confirm(payment.id, 'tok_test')).rejects.toBeInstanceOf(TapayaConnectionError)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('shares explicit transport options and allows embedded overrides', async () => {
    const commonFetch = vi.fn().mockResolvedValue(Response.json(payment))
    const embeddedFetch = vi.fn().mockResolvedValue(Response.json(payment))
    const common = new Tapaya('secret', { fetch: commonFetch, baseUrl: 'http://localhost:5000', timeoutMs: 900 })
    await common.checkout.sessions.create({ ...order, mode: 'embedded' })
    expect(commonFetch.mock.calls[0][0]).toBe('http://localhost:5000/merchant/payments')
    const overridden = new Tapaya('secret', {
      fetch: commonFetch, baseUrl: 'http://localhost:5000', timeoutMs: 900,
      embedded: { fetch: embeddedFetch, baseUrl: 'http://localhost:5001', timeoutMs: 1000 },
    })
    await overridden.checkout.sessions.create({ ...order, mode: 'embedded' })
    expect(embeddedFetch.mock.calls[0][0]).toBe('http://localhost:5001/merchant/payments')
    expect(commonFetch).toHaveBeenCalledTimes(1)
  })

  it('applies embedded timeout defaults, constructor overrides, and per-request overrides', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const fetcher = vi.fn().mockImplementation(async () => Response.json(payment))
    const defaults = new Tapaya('secret', { fetch: fetcher }).checkout.sessions
    await defaults.retrieve(payment.id, { mode: 'embedded' })
    expect(timeout).toHaveBeenLastCalledWith(35_000)
    const shared = new Tapaya('secret', { fetch: fetcher, timeoutMs: 900 }).checkout.sessions
    await shared.retrieve(payment.id, { mode: 'embedded' })
    expect(timeout).toHaveBeenLastCalledWith(900)
    const overridden = new Tapaya('secret', { fetch: fetcher, timeoutMs: 900, embedded: { timeoutMs: 1000 } }).checkout.sessions
    await overridden.retrieve(payment.id, { mode: 'embedded' })
    expect(timeout).toHaveBeenLastCalledWith(1000)
    await overridden.retrieve(payment.id, { mode: 'embedded', timeoutMs: 2000 })
    expect(timeout).toHaveBeenLastCalledWith(2000)
  })

  it('rejects invalid selectors and hosted-only embedded fields before sending', async () => {
    const fetcher = vi.fn()
    const sessions = new Tapaya('secret', { fetch: fetcher }).checkout.sessions
    await expect(sessions.create({ ...order, mode: 'other' } as unknown as CreateCheckoutSessionParams)).rejects.toBeInstanceOf(TapayaValidationError)
    await expect(sessions.retrieve(payment.id, { mode: 'other' } as unknown as RetrieveEmbeddedSessionOptions)).rejects.toBeInstanceOf(TapayaValidationError)
    await expect(sessions.create({ ...order, mode: 'embedded', items: [] } as CreateCheckoutSessionParams)).rejects.toBeInstanceOf(TapayaValidationError)
    await expect(sessions.create({ ...order, mode: 'embedded' }, { maxRetries: 1 } as CreateEmbeddedSessionOptions)).rejects.toBeInstanceOf(TapayaValidationError)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps embedded checkout server-only', async () => {
    vi.stubGlobal('window', {})
    const fetcher = vi.fn()
    const sessions = new Tapaya('secret', { fetch: fetcher }).checkout.sessions
    await expect(sessions.create({ ...order, mode: 'embedded' })).rejects.toThrow('must only run on the server')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps union return types narrowable by mode', () => {
    function check(session: CheckoutSession) {
      if (session.mode === 'embedded') {
        expectTypeOf(session).toEqualTypeOf<EmbeddedCheckoutSession>()
        expectTypeOf(session.clientSecret).toEqualTypeOf<string | null>()
      } else {
        expectTypeOf(session).toEqualTypeOf<HostedCheckoutSession>()
        expectTypeOf(session.url).toEqualTypeOf<string>()
      }
    }
    expectTypeOf(check).parameter(0).toEqualTypeOf<CheckoutSession>()
  })

  it('routes embedded calls of the development environment to the dev API and reports its origin', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ publishableKey: `pk_dev_${'a'.repeat(32)}`, environment: 'development' }))
    const tapaya = new Tapaya('secret', { fetch: fetcher, environment: 'development' })
    expect(await tapaya.checkout.configuration()).toMatchObject({ apiOrigin: 'https://api.dev.tapaya.com' })
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.dev.tapaya.com/merchant/payments/configuration')
  })
})
