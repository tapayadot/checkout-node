import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Tapaya,
  TapayaApiError,
  TapayaAuthenticationError,
  TapayaConflictError,
  TapayaConnectionError,
  TapayaError,
  TapayaInvalidRequestError,
  TapayaNotFoundError,
  TapayaPermissionError,
  TapayaRateLimitError,
  TapayaResponseError,
  TapayaServerError,
  TapayaTimeoutError,
  TapayaValidationError,
  VERSION,
} from './index'
import type { CheckoutSession, CreateCheckoutSessionParams, TapayaEnvironment, TapayaOptions } from './index'

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

/** Runs fake timers until the promise settles, so retry backoff does not slow tests down. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false
  promise.then(() => { done = true }, () => { done = true })
  while (!done) {
    await vi.advanceTimersByTimeAsync(60_000)
    await new Promise((resolve) => setImmediate(resolve))
  }
  return promise
}

function client(fetchImpl: unknown, options: TapayaOptions = {}) {
  return new Tapaya('secret', { fetch: fetchImpl as typeof fetch, ...options }).checkout.sessions
}

const params = {
  merchantOrderId: 'ORDER-1', amount: 120, currency: 'EUR', locale: 'en', tax: 20,
  successUrl: 'https://shop.test/success', cancelUrl: 'https://shop.test/cancel',
} satisfies CreateCheckoutSessionParams
const item = {
  reference: 'TAP-START-PHN', name: 'Tapaya Starter', description: '',
  imageUrl: 'https://cdn.merchant.example/products/tapaya-starter.webp', quantity: 1, unitAmount: 25523,
}
const created = {
  tax: 0, shipping: 0, taxBreakdown: [],
  id: 'cs_Y7u2d', merchantOrderId: 'ORDER-1',
  url: 'https://checkout.tapaya.com/c/cs_Y7u2d',
  status: 'open', paymentStatus: 'unpaid', amount: 120, currency: 'EUR',
  expiresAt: '2026-09-05T19:00:00Z', createdAt: '2026-09-05T18:30:00Z',
} as const
const session: CheckoutSession = { ...created, taxBreakdown: [], taxRate: null, items: [], paymentReference: null, completedAt: null }

beforeEach(() => {
  vi.stubEnv('TAPAYA_ENVIRONMENT', undefined)
  vi.stubEnv('TAPAYA_SECRET_KEY', undefined)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  // Restore spies first so a spy on a fake timer cannot outlive the fake timers.
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('client configuration', () => {
  it.each([
    ['sandbox', 'https://api.sandbox.tapaya.com'],
    ['production', 'https://api.tapaya.com'],
  ] as const)('routes requests to the explicit %s environment', async (environment, host) => {
    vi.stubEnv('TAPAYA_ENVIRONMENT', 'invalid')
    const fetchImpl = vi.fn().mockImplementation(async () => response(200, created))
    const sessions = client(fetchImpl, { environment })
    await sessions.create(params)
    await sessions.retrieve(created.id)
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `${host}/merchant/checkout-sessions`,
      `${host}/merchant/checkout-sessions/${created.id}`,
    ])
  })

  it('reads the API key and environment from the environment once, at construction', async () => {
    vi.stubEnv('TAPAYA_SECRET_KEY', 'environment-secret')
    vi.stubEnv('TAPAYA_ENVIRONMENT', 'production')
    const fetchImpl = vi.fn().mockImplementation(async () => response(200, created))
    const sessions = new Tapaya(undefined, { fetch: fetchImpl }).checkout.sessions
    vi.stubEnv('TAPAYA_SECRET_KEY', 'changed-secret')
    vi.stubEnv('TAPAYA_ENVIRONMENT', 'sandbox')
    await sessions.retrieve(created.id)
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://api.tapaya.com/merchant/checkout-sessions/${created.id}`)
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer environment-secret')
  })

  it('defaults to sandbox and the global fetch', async () => {
    vi.stubEnv('TAPAYA_SECRET_KEY', 'secret')
    const fetchImpl = vi.fn().mockResolvedValue(response(200, created))
    vi.stubGlobal('fetch', fetchImpl)
    await new Tapaya().checkout.sessions.create(params)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.sandbox.tapaya.com/merchant/checkout-sessions')
  })

  it.each([undefined, '', '   '])('rejects a missing or blank environment key: %j', (apiKey) => {
    vi.stubEnv('TAPAYA_SECRET_KEY', apiKey)
    expect(() => new Tapaya()).toThrow('Tapaya API key is required')
  })

  it.each(['', '   '])('rejects a blank explicit key instead of falling back: %j', (apiKey) => {
    vi.stubEnv('TAPAYA_SECRET_KEY', 'environment-secret')
    expect(() => new Tapaya(apiKey)).toThrow('Tapaya API key is required')
  })

  it.each(['', '   ', 'dev', 'PRODUCTION', 'toString'])('rejects invalid environment defaults: %j', (environment) => {
    vi.stubEnv('TAPAYA_ENVIRONMENT', environment)
    expect(() => new Tapaya('secret')).toThrow(/Invalid Tapaya environment/)
  })

  it('rejects an invalid explicit environment without falling back', () => {
    vi.stubEnv('TAPAYA_ENVIRONMENT', 'sandbox')
    expect(() => new Tapaya('secret', { environment: 'dev' as TapayaEnvironment }))
      .toThrow(/Invalid Tapaya environment/)
  })

  it('gives a custom base URL precedence over environment selection', async () => {
    vi.stubEnv('TAPAYA_ENVIRONMENT', 'invalid')
    const fetchImpl = vi.fn().mockResolvedValue(response(200, created))
    await client(fetchImpl, { environment: 'production', baseUrl: 'https://api.dev.tapaya.com/' }).create(params)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.dev.tapaya.com/merchant/checkout-sessions')
  })

  it.each([
    'not a URL', 'http://api.example.test', 'ftp://api.example.test',
    'https://user:secret@api.example.test', 'http://localhost.attacker.test',
  ])('rejects unsafe API base URLs: %s', (baseUrl) => {
    expect(() => new Tapaya('secret', { baseUrl })).toThrow(TapayaError)
  })

  it.each(['localhost', '127.0.0.1', '[::1]'])('allows HTTP to %s outside production only', async (host) => {
    const baseUrl = `http://${host}:4321`
    const fetchImpl = vi.fn().mockImplementation(async () => response(200, created))
    vi.stubEnv('NODE_ENV', 'development')
    await client(fetchImpl, { baseUrl }).retrieve(created.id)
    expect(fetchImpl.mock.calls[0][0]).toBe(`${baseUrl}/merchant/checkout-sessions/${created.id}`)
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('error')
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => new Tapaya('secret', { baseUrl })).toThrow(/API base URL/)
  })

  const invalidTransportOptions = [
    { timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: 1.5 }, { timeoutMs: NaN }, { timeoutMs: 2 ** 31 },
    { maxRetries: -1 }, { maxRetries: NaN }, { maxRetries: Infinity },
  ]

  it.each(invalidTransportOptions)('rejects invalid transport options: %j', (options) => {
    expect(() => new Tapaya('secret', options)).toThrow(/Invalid (timeoutMs|maxRetries)/)
  })

  it.each(invalidTransportOptions)('rejects invalid per-request transport options: %j', async (options) => {
    const fetchImpl = vi.fn()
    const sessions = client(fetchImpl)
    const field = Object.keys(options)[0]
    await expect(sessions.retrieve(created.id, options)).rejects.toMatchObject({
      name: 'TapayaValidationError',
      message: `Invalid ${field}`,
      fieldErrors: [{ field, message: `Invalid ${field}` }],
    })
    await expect(sessions.create(params, options)).rejects.toBeInstanceOf(TapayaValidationError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends identifying headers on every request', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => response(200, created))
    const sessions = client(fetchImpl)
    await sessions.create(params, { idempotencyKey: 'attempt-1' })
    await sessions.retrieve(created.id)
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({
      accept: 'application/json',
      authorization: 'Bearer secret',
      'user-agent': `tapaya-checkout-js/${VERSION}`,
      'content-type': 'application/json',
      'idempotency-key': 'attempt-1',
    })
    expect(fetchImpl.mock.calls[1][1].headers).toEqual({
      accept: 'application/json',
      authorization: 'Bearer secret',
      'user-agent': `tapaya-checkout-js/${VERSION}`,
    })
  })

  it('reports the published package version', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(VERSION).toBe(manifest.version)
  })
})

describe('checkout.sessions.create', () => {
  it('sends only supported fields and returns the full session shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, created))
    await expect(client(fetchImpl).create({ ...params, lineItems: [] } as unknown as CreateCheckoutSessionParams))
      .resolves.toEqual(session)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.sandbox.tapaya.com/merchant/checkout-sessions')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual(params)
  })

  it.each([
    {},
    { email: 'buyer@example.com' },
    { billingAddress: { postalCode: '110 00', country: 'CZ' } },
    { shippingAddress: { name: 'Grace Hopper', phone: '+420123456789' } },
  ])('accepts partial optional customer details: %j', async (customer) => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, created))
    await client(fetchImpl).create({ ...params, customer })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).customer).toEqual(customer)
  })

  it('preserves explicit nulls in every optional field', async () => {
    const nullableParams: CreateCheckoutSessionParams = {
      amount: 120, currency: 'EUR', merchantOrderId: null, locale: null,
      successUrl: null, cancelUrl: null, items: null, tax: null, shipping: null,
      taxRate: null, taxBreakdown: null,
      customer: { email: null, billingAddress: { name: null, country: null }, shippingAddress: null },
    }
    const fetchImpl = vi.fn().mockResolvedValue(response(200, created))
    await client(fetchImpl).create(nullableParams)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(nullableParams)
  })

  it('omits optional fields when absent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, created))
    await client(fetchImpl).create({ amount: 120, currency: 'EUR' })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ amount: 120, currency: 'EUR' })
  })

  it.each([
    [{ amount: 0 }, 'amount'], [{ amount: 1.5 }, 'amount'], [{ amount: 2_147_483_648 }, 'amount'],
    [{ amount: '120' }, 'amount'], [{ tax: -1 }, 'tax'], [{ tax: NaN }, 'tax'],
    [{ currency: 'EU' }, 'currency'], [{ currency: 'EURO' }, 'currency'], [{ currency: 978 }, 'currency'],
    [{ shipping: 0.5 }, 'shipping'], [{ taxRate: -1 }, 'taxRate'], [{ locale: 1 }, 'locale'],
    [{ taxBreakdown: [{ taxRate: 5.5, tax: 1.5 }] }, 'taxBreakdown.0.tax'],
    [{ customer: { email: 42 } }, 'customer.email'],
    [{ customer: { email: `${'a'.repeat(243)}@example.com` } }, 'customer.email'],
    [{ customer: { billingAddress: { country: 203 } } }, 'customer.billingAddress.country'],
    [{ items: [{ ...item, name: undefined }] }, 'items.0.name'],
    [{ items: [{ ...item, imageUrl: null }] }, 'items.0.imageUrl'],
    [{ items: [{ ...item, quantity: 0 }] }, 'items.0.quantity'],
    [{ items: [{ ...item, quantity: 1.5 }] }, 'items.0.quantity'],
    [{ items: [{ ...item, unitAmount: -1 }] }, 'items.0.unitAmount'],
  ])('rejects invalid input before sending: %j', async (override, field) => {
    const fetchImpl = vi.fn()
    const error = await client(fetchImpl).create({ ...params, ...override } as CreateCheckoutSessionParams)
      .catch((error: unknown) => error)
    expect(error).toBeInstanceOf(TapayaValidationError)
    expect(error).toMatchObject({ message: 'Invalid checkout session parameters' })
    expect((error as TapayaValidationError).fieldErrors.map((entry) => entry.field)).toContain(field)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('leaves business rules to the API and sends input as given', async () => {
    const lenient: CreateCheckoutSessionParams = {
      amount: 120, currency: 'eur',
      items: [{ ...item, reference: '', name: '', imageUrl: '/relative.png' }],
      customer: {
        email: ' not-an-email ',
        billingAddress: { line1: ' ', country: 'CZE', postalCode: 'x'.repeat(50) },
      },
    }
    const fetchImpl = vi.fn().mockResolvedValue(response(200, created))
    await client(fetchImpl).create(lenient)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(lenient)
  })

  it.each(['successUrl', 'cancelUrl'] as const)('rejects unsafe %s before sending', async (field) => {
    const fetchImpl = vi.fn()
    for (const url of ['javascript:alert(1)', 'https://user:pass@shop.test/return', '/relative']) {
      await expect(client(fetchImpl).create({ ...params, [field]: url })).rejects.toBeInstanceOf(TapayaValidationError)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('allows local return URLs in development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const fetchImpl = vi.fn().mockResolvedValue(response(200, created))
    const localParams = { ...params, successUrl: 'http://localhost:3000/return', cancelUrl: 'http://localhost:3000/cancel' }
    await client(fetchImpl).create(localParams)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(localParams)
  })

  it.each([
    { tax: 2100, shipping: 605, taxRate: 21 },
    { tax: 2650, shipping: 605, taxBreakdown: [{ taxRate: 21, tax: 2100 }, { taxRate: 5.5, tax: 550 }] },
  ])('preserves tax and shipping: %j', async (totals) => {
    const body = { ...created, amount: 22650, ...totals }
    const fetchImpl = vi.fn().mockResolvedValue(response(200, body))
    await expect(client(fetchImpl).create({ ...params, amount: body.amount, ...totals }))
      .resolves.toEqual({ ...session, ...body })
  })

  it('types taxRate and taxBreakdown as alternatives', () => {
    const single: CreateCheckoutSessionParams = { ...params, taxRate: 21, taxBreakdown: null }
    const mixed: CreateCheckoutSessionParams = { ...params, taxRate: null, taxBreakdown: [{ taxRate: 21, tax: 20 }] }
    // @ts-expect-error Send either taxRate or taxBreakdown, not both.
    const both: CreateCheckoutSessionParams = { ...params, taxRate: 21, taxBreakdown: [{ taxRate: 21, tax: 20 }] }
  })

  it('sends items and returns them', async () => {
    const items = [item]
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { ...created, items }))
    await expect(client(fetchImpl).create({ ...params, items })).resolves.toEqual({ ...session, items })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).items).toEqual(items)
  })

  it('defaults omitted response totals and items', async () => {
    const { tax, shipping, taxBreakdown, ...legacy } = created
    await expect(client(vi.fn().mockResolvedValue(response(200, legacy))).create(params)).resolves.toEqual(session)
  })

  it('generates a UUID idempotency key per call', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => response(200, created))
    const sessions = client(fetchImpl)
    await sessions.create(params)
    await sessions.create(params)
    const [first, second] = fetchImpl.mock.calls.map(([, init]) => init.headers['idempotency-key'])
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(second).not.toBe(first)
  })

  it.each(['', '   ', 'k'.repeat(256), 'key\r\ninjected', 'key\0', 'keyĀ'])(
    'rejects invalid idempotency keys before sending: %j', async (idempotencyKey) => {
      const fetchImpl = vi.fn()
      await expect(client(fetchImpl).create(params, { idempotencyKey })).rejects.toThrow(TapayaValidationError)
      expect(fetchImpl).not.toHaveBeenCalled()
    },
  )
})

describe('checkout.sessions.retrieve', () => {
  it('returns the complete session', async () => {
    const body = { ...created, items: [item], status: 'completed', paymentStatus: 'successful',
      paymentReference: 'pay_a82Hd', completedAt: '2026-09-05T18:32:00Z' }
    const fetchImpl = vi.fn().mockResolvedValue(response(200, body))
    await expect(client(fetchImpl).retrieve(created.id)).resolves.toEqual({ ...session, ...body })
    expect(fetchImpl.mock.calls[0][1].method).toBe('GET')
  })

  it('returns a decline as a failed payment, not an error', async () => {
    const body = { ...session, paymentStatus: 'failed', paymentReference: 'pay_declined' }
    await expect(client(vi.fn().mockResolvedValue(response(200, body))).retrieve(created.id)).resolves.toEqual(body)
  })

  it.each(['', ' ', '.', '..', 'x'.repeat(201)])('rejects invalid IDs before sending: %j', async (id) => {
    const fetchImpl = vi.fn()
    await expect(client(fetchImpl).retrieve(id)).rejects.toThrow(TapayaValidationError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns the session as sent, even with a different ID', async () => {
    const body = { ...created, id: 'CS_Y7U2D' }
    await expect(client(vi.fn().mockResolvedValue(response(200, body))).retrieve(created.id))
      .resolves.toEqual({ ...session, id: 'CS_Y7U2D' })
  })

  it('encodes the session ID', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { ...created, id: 'cs/a b' }))
    await client(fetchImpl).retrieve('cs/a b')
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.sandbox.tapaya.com/merchant/checkout-sessions/cs%2Fa%20b')
  })
})

describe('responses', () => {
  it.each(['create', 'retrieve'] as const)('validates required fields on %s', async (method) => {
    for (const field of ['id', 'merchantOrderId', 'url', 'status', 'paymentStatus', 'amount', 'currency', 'expiresAt', 'createdAt']) {
      const body: Record<string, unknown> = { ...created }
      delete body[field]
      const sessions = client(vi.fn().mockResolvedValue(response(200, body)))
      await expect(method === 'create' ? sessions.create(params) : sessions.retrieve(created.id))
        .rejects.toMatchObject({ name: 'TapayaResponseError', status: 200 })
    }
  })

  it.each([
    { id: '' }, { id: 1 }, { url: null }, { merchantOrderId: 1 }, { status: null }, { amount: '120' },
    { currency: 978 }, { createdAt: 0 }, { items: null }, { items: [{ ...item, quantity: '1' }] },
  ])('rejects fields of the wrong type: %j', async (override) => {
    const sessions = client(vi.fn().mockResolvedValue(response(200, { ...created, ...override })))
    await expect(sessions.retrieve(created.id)).rejects.toBeInstanceOf(TapayaResponseError)
  })

  it('accepts new status values and loose response data', async () => {
    const looseItem = { reference: '', name: '', description: '', imageUrl: 'cdn/p.png', quantity: 0, unitAmount: 0 }
    const body = {
      ...created, status: 'archived', paymentStatus: 'partially_refunded', amount: 0, currency: 'eur',
      merchantOrderId: '', createdAt: 'not a timestamp',
    }
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { ...body, items: [{ ...looseItem, extra: true }] }))
    await expect(client(fetchImpl).retrieve(created.id)).resolves.toStrictEqual({ ...session, ...body, items: [looseItem] })
  })

  it.each([
    'http://checkout.tapaya.com/c/cs_Y7u2d', 'javascript:alert(1)',
    'https://user:secret@checkout.tapaya.com/c/cs_Y7u2d', 'http://localhost.attacker.test/c/cs_Y7u2d',
  ])('rejects unsafe hosted URLs: %s', async (url) => {
    const sessions = client(vi.fn().mockResolvedValue(response(200, { ...created, url })))
    await expect(sessions.create(params)).rejects.toThrow(/unexpected checkout URL/)
  })

  it('accepts additive fields and opaque checkout URLs', async () => {
    const url = 'https://hosted.example.test/checkout/token?locale=en#payment'
    const sessions = client(vi.fn().mockResolvedValue(response(200, { ...created, url, futureField: {} })))
    await expect(sessions.create(params)).resolves.toEqual({ ...session, url })
  })

  it('rejects invalid JSON in a successful response without retrying', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>broken</html>', { status: 200 }))
    await expect(client(fetchImpl).create(params)).rejects.toMatchObject({
      name: 'TapayaResponseError', status: 200, message: 'Tapaya returned invalid JSON',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('errors', () => {
  it.each([
    [400, TapayaInvalidRequestError], [401, TapayaAuthenticationError], [403, TapayaPermissionError],
    [404, TapayaNotFoundError], [409, TapayaConflictError], [422, TapayaInvalidRequestError],
    [500, TapayaServerError], [418, TapayaApiError],
  ] as const)('maps HTTP %s to its error class without retrying', async (status, ErrorClass) => {
    const body = { message: 'Request rejected', errorCode: 'ApiValidationViolated' }
    const fetchImpl = vi.fn().mockImplementation(async () => response(status, body))
    const error = await client(fetchImpl).create(params).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(ErrorClass)
    expect(error).toBeInstanceOf(TapayaApiError)
    expect(error).toBeInstanceOf(TapayaError)
    expect(error).toMatchObject({ name: ErrorClass.name, status, message: body.message, code: body.errorCode, fieldErrors: [] })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('exposes response headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(404, { message: 'Not found' }, { 'x-trace': 'abc' }))
    const error = await client(fetchImpl).retrieve(created.id).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(TapayaNotFoundError)
    expect((error as TapayaApiError).headers.get('x-trace')).toBe('abc')
  })

  it.each(['API-0022', 'API-0025', undefined])('does not retry conflict %s', async (errorCode) => {
    const fetchImpl = vi.fn().mockImplementation(async () => response(409, { message: 'Conflict', errorCode }))
    await expect(settle(client(fetchImpl).create(params))).rejects.toMatchObject({
      name: 'TapayaConflictError', code: errorCode,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('exposes backend field errors', async () => {
    const errors = [{ field: 'amount', message: 'Invalid amount', code: 'range' }, { field: 'currency', message: 'Unsupported' }]
    const body = { message: 'Validation failed', errorCode: 'ApiValidationViolated', errors: [...errors, 'junk', { field: 1 }] }
    await expect(client(vi.fn().mockResolvedValue(response(400, body))).retrieve(created.id))
      .rejects.toMatchObject({ name: 'TapayaInvalidRequestError', fieldErrors: errors })
  })

  it.each([null, [], 'error', { message: 42, errorCode: 42 }, { message: ' ' }])(
    'falls back for unrecognized error bodies: %j', async (body) => {
      await expect(client(vi.fn().mockResolvedValue(response(400, body))).create(params)).rejects.toMatchObject({
        status: 400, message: 'Tapaya rejected the request parameters (400)', code: undefined, fieldErrors: [],
      })
    },
  )

  it('falls back for non-JSON error bodies', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 401 }))
    await expect(client(fetchImpl).create(params)).rejects.toMatchObject({
      name: 'TapayaAuthenticationError', status: 401,
      message: 'Tapaya rejected the API key. Check that it is valid, active, and matches the environment (401)',
    })
  })

  it.each([
    [403, 'The API key is not allowed to make this request (403)'],
    [404, 'Tapaya could not find the requested resource (404)'],
    [409, 'The request conflicts with an earlier request (409)'],
    [422, 'Tapaya rejected the request parameters (422)'],
    [429, 'Too many requests to Tapaya. Try again later (429)'],
    [500, 'Tapaya could not process the request (500)'],
    [418, 'Tapaya request failed (418)'],
  ] as const)('describes HTTP %s when the response has no message', async (status, message) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status }))
    await expect(client(fetchImpl, { maxRetries: 0 }).retrieve(created.id)).rejects.toMatchObject({ status, message })
  })

  it('exposes the request ID', async () => {
    const headers = { 'x-request-id': 'req_123' }
    const apiError = client(vi.fn().mockResolvedValue(response(404, { message: 'Not found' }, headers))).retrieve(created.id)
    await expect(apiError).rejects.toMatchObject({ name: 'TapayaNotFoundError', requestId: 'req_123' })
    const responseError = client(vi.fn().mockResolvedValue(response(200, { id: 'cs_Y7u2d' }, headers))).retrieve(created.id)
    await expect(responseError).rejects.toMatchObject({ name: 'TapayaResponseError', requestId: 'req_123' })
    const error = await responseError.catch((error: unknown) => error)
    expect((error as TapayaResponseError).headers.get('x-request-id')).toBe('req_123')
    await expect(client(vi.fn().mockResolvedValue(response(404, {}))).retrieve(created.id))
      .rejects.toMatchObject({ requestId: undefined })
  })
})

describe('retries', () => {
  it.each(['create', 'retrieve'] as const)('retries %s with backoff and the same request', async (method) => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(response(503, {}))
      .mockImplementation(async () => response(200, created))
    const sessions = client(fetchImpl)
    const result = settle(method === 'create' ? sessions.create(params) : sessions.retrieve(created.id))
    await expect(result).resolves.toEqual(session)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    const [first, ...rest] = fetchImpl.mock.calls.map(([, init]) => init)
    for (const init of rest) {
      expect(init.headers).toEqual(first.headers)
      expect(init.body).toBe(first.body)
    }
  })

  it('waits before retrying', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(503, {}))
      .mockImplementation(async () => response(200, created))
    const result = client(fetchImpl).create(params)
    await vi.advanceTimersByTimeAsync(499)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toEqual(session)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('backs off exponentially with jitter', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const timeouts = vi.spyOn(globalThis, 'setTimeout')
    const fetchImpl = vi.fn().mockImplementation(async () => response(503, {}))
    await expect(settle(client(fetchImpl, { maxRetries: 5 }).create(params))).rejects.toBeInstanceOf(TapayaServerError)
    expect(timeouts.mock.calls.map(([, delay]) => delay)).toEqual([250, 500, 1000, 2000, 4000])
  })

  it.each([['1', 1000], ['0', 0]])('honors Retry-After: %s seconds', async (header, delay) => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(429, {}, { 'retry-after': header }))
      .mockImplementation(async () => response(200, created))
    const result = client(fetchImpl).retrieve(created.id)
    if (delay > 0) {
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toEqual(session)
  })

  it('waits for a Retry-After of up to 10 seconds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(429, {}, { 'retry-after': '10' }))
      .mockImplementation(async () => response(200, created))
    const result = client(fetchImpl).retrieve(created.id)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toEqual(session)
  })

  it('does not wait for a Retry-After of 11 seconds', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(429, { message: 'Slow down' }, { 'retry-after': '11' }))
    await expect(client(fetchImpl).create(params)).rejects.toMatchObject({
      name: 'TapayaRateLimitError', retryAfterMs: 11_000, message: 'Slow down',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([429, 502, 503, 504])('surfaces HTTP %s after the configured retries', async (status) => {
    const fetchImpl = vi.fn().mockImplementation(async () => response(status, { message: 'Unavailable' }))
    const error = await settle(client(fetchImpl).create(params)).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(status === 429 ? TapayaRateLimitError : TapayaServerError)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('retries a create still in progress with the same key and body', async () => {
    const inProgress = { message: 'Request is still being processed', errorCode: 'API-0024' }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(409, inProgress))
      .mockImplementation(async () => response(200, created))
    await expect(settle(client(fetchImpl).create(params))).resolves.toEqual(session)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const [first, second] = fetchImpl.mock.calls.map(([, init]) => init)
    expect(second.headers).toEqual(first.headers)
    expect(second.body).toBe(first.body)
  })

  it('surfaces a create still in progress after the configured retries', async () => {
    const inProgress = { message: 'Request is still being processed', errorCode: 'API-0024' }
    const fetchImpl = vi.fn().mockImplementation(async () => response(409, inProgress))
    await expect(settle(client(fetchImpl).create(params))).rejects.toMatchObject({
      name: 'TapayaConflictError', status: 409, code: 'API-0024',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('lets each request override maxRetries', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => response(503, {}))
    const sessions = client(fetchImpl, { maxRetries: 0 })
    await expect(sessions.retrieve(created.id)).rejects.toBeInstanceOf(TapayaServerError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await expect(settle(sessions.retrieve(created.id, { maxRetries: 1 }))).rejects.toBeInstanceOf(TapayaServerError)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('wraps persistent network failures in TapayaConnectionError', async () => {
    const cause = new TypeError('fetch failed')
    const fetchImpl = vi.fn().mockRejectedValue(cause)
    const error = await settle(client(fetchImpl).create(params)).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(TapayaConnectionError)
    expect(error).not.toBeInstanceOf(TapayaTimeoutError)
    expect(error).toMatchObject({ message: 'Could not connect to Tapaya', cause })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('retries a failed body read with the same request', async () => {
    const broken = response(200, {})
    vi.spyOn(broken, 'text').mockRejectedValue(new TypeError('Connection reset'))
    const fetchImpl = vi.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(response(200, created))
    await expect(settle(client(fetchImpl).create(params))).resolves.toEqual(session)
    expect(fetchImpl.mock.calls[1][1].body).toBe(fetchImpl.mock.calls[0][1].body)
    expect(fetchImpl.mock.calls[1][1].signal).not.toBe(fetchImpl.mock.calls[0][1].signal)
  })

  it('retries a real connection reset with the same key and body', async () => {
    vi.useRealTimers()
    vi.stubEnv('NODE_ENV', 'test')
    const requests: { key: string | string[] | undefined, body: string }[] = []
    const server = createServer(async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      requests.push({ key: req.headers['idempotency-key'], body })
      res.writeHead(200, { 'content-type': 'application/json' })
      if (requests.length === 1) {
        res.write('{"id":')
        setTimeout(() => res.destroy(), 10)
      } else {
        res.end(JSON.stringify(created))
      }
    })
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected a local TCP server')
      const sessions = new Tapaya('secret', { baseUrl: `http://127.0.0.1:${address.port}` }).checkout.sessions
      await expect(sessions.create(params, { idempotencyKey: 'body-reset' })).resolves.toEqual(session)
      expect(requests).toHaveLength(2)
      expect(requests[1]).toEqual(requests[0])
      expect(requests[0].key).toBe('body-reset')
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})

describe('timeouts and cancellation', () => {
  function hangingFetch() {
    return vi.fn().mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
  }

  it('throws TapayaTimeoutError after each attempt times out', async () => {
    const fetchImpl = hangingFetch()
    const error = await settle(client(fetchImpl, { timeoutMs: 5, maxRetries: 1 }).retrieve(created.id))
      .catch((error: unknown) => error)
    expect(error).toBeInstanceOf(TapayaTimeoutError)
    expect(error).toBeInstanceOf(TapayaConnectionError)
    expect(error).toMatchObject({ message: 'Tapaya request timed out after 5 ms' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('lets each request override the timeout', async () => {
    const fetchImpl = hangingFetch()
    await expect(settle(client(fetchImpl, { maxRetries: 0 }).retrieve(created.id, { timeoutMs: 5 })))
      .rejects.toThrow('Tapaya request timed out after 5 ms')
  })

  it('rejects with the abort reason and does not retry', async () => {
    const fetchImpl = hangingFetch()
    const controller = new AbortController()
    const result = client(fetchImpl).create(params, { signal: controller.signal })
    const reason = new Error('Customer left')
    controller.abort(reason)
    await expect(result).rejects.toBe(reason)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not send a request when the signal is already aborted', async () => {
    const fetchImpl = vi.fn()
    const signal = AbortSignal.abort()
    await expect(client(fetchImpl).retrieve(created.id, { signal })).rejects.toBe(signal.reason)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('stops waiting between retries when aborted', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(503, {}))
    const controller = new AbortController()
    const result = client(fetchImpl).create(params, { signal: controller.signal })
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
    controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
