import { describe, expect, it, vi } from 'vitest'
import { Tapaya, TapayaValidationError } from './index.js'

const method = {
  id: 'pm_example', type: 'card', customerReference: 'buyer-42', usage: 'on_session',
  card: { brand: 'visa', funding: 'credit', last4: '4242', expMonth: 12, expYear: 2030, cardholderName: null, country: 'CZ', wallet: null },
  fingerprint: 'fp_example', billingAddress: null, status: 'active',
  source: { type: 'payment', id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
  createdAt: '2026-10-21T10:00:00Z', updatedAt: '2026-10-21T10:00:00Z',
}
function client(body: unknown) {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(body))
  return { api: new Tapaya('secret', { baseUrl: 'https://api.sandbox.tapaya.com', merchantToken: 'merchant-a', fetch: fetcher, maxRetries: 0 }), fetcher }
}
const input = { merchantOrderId: 'order-1', amount: 1200, currency: 'EUR' }

describe('card saving', () => {
  it.each(['hosted', 'embedded'] as const)('forwards saving instructions for %s checkout and preserves the returned ID', async mode => {
    const response = mode === 'hosted' ? {
      id: 'cs_example', url: 'https://checkout.tapaya.com/c/cs_example', ...input, status: 'completed', paymentStatus: 'successful',
      paymentMethodId: method.id, createdAt: method.createdAt, expiresAt: method.createdAt,
    } : {
      id: method.source.id, ...input, status: 'successful', retryAllowed: false, clientSecret: null, paymentMethodId: method.id,
    }
    const { api, fetcher } = client(response)
    const policy = { customerReference: 'buyer-42', savePaymentMethod: 'optional' as const, paymentMethodUsage: 'on_session' as const }
    expect(await api.checkout.sessions.create({ ...input, ...policy, mode })).toMatchObject({ paymentMethodId: method.id })
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject(policy)
  })
  it.each([
    { savePaymentMethod: 'optional' },
    { savePaymentMethod: 'required', customerReference: ' ' },
    { savePaymentMethod: 'none', paymentMethodUsage: 'on_session' },
  ])('rejects invalid saving policies before sending a request', async policy => {
    const { api, fetcher } = client({})
    await expect(api.checkout.sessions.create({ ...input, ...policy } as never)).rejects.toBeInstanceOf(TapayaValidationError)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('encodes customer references and cursors, uses merchant auth, and preserves card details', async () => {
    const { api, fetcher } = client({ data: [method], nextCursor: 'next-page' })
    expect(await api.paymentMethods.list({ customerReference: 'buyer +42', limit: 20, cursor: 'a/b' })).toEqual({ data: [method], nextCursor: 'next-page' })
    const [url, init] = fetcher.mock.calls[0]
    expect(new URL(String(url)).pathname).toBe('/merchant/saved-payment-methods')
    expect(new URL(String(url)).searchParams.get('customerReference')).toBe('buyer +42')
    expect(new URL(String(url)).searchParams.get('cursor')).toBe('a/b')
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer secret')
    expect(new Headers(init!.headers).get('x-tapaya-merchant-token')).toBe('merchant-a')
  })
  it('retrieves, updates, and deletes through the card lifecycle resource', async () => {
    const { api, fetcher } = client(method)
    expect(await api.paymentMethods.get(method.id)).toEqual(method)
    await api.paymentMethods.update(method.id, { cardholderName: 'Grace Hopper', billingAddress: { city: 'Brno' } })
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ cardholderName: 'Grace Hopper', billingAddress: { city: 'Brno' } }) })
    fetcher.mockResolvedValueOnce(Response.json({ id: method.id, deleted: true }))
    expect(await api.paymentMethods.delete(method.id)).toEqual({ id: method.id, deleted: true })
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(Array(3).fill('/merchant/saved-payment-methods/pm_example'))
    expect(fetcher.mock.calls[2][1]!.method).toBe('DELETE')
  })
  it('accepts wallet methods with their agreement and filters by wallet', async () => {
    const agreement = { type: 'recurring', description: 'Pro plan', managementUrl: 'https://shop.example/billing',
      recurring: { amount: 990, interval: 'month', intervalCount: 1, startDate: null }, automaticReload: null }
    const wallet = { ...method, card: { ...method.card, wallet: { type: 'apple_pay', deviceBound: true } }, walletAgreement: agreement }
    const { api, fetcher } = client({ data: [wallet], nextCursor: null })
    expect(await api.paymentMethods.list({ customerReference: 'buyer-42', wallet: 'apple_pay' })).toEqual({ data: [wallet], nextCursor: null })
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('wallet')).toBe('apple_pay')
    await expect(api.paymentMethods.list({ customerReference: 'buyer-42', wallet: 'paypal' } as never)).rejects.toBeInstanceOf(TapayaValidationError)
  })
  it.each([
    { savePaymentMethod: 'optional', paymentMethodUsage: 'on_session' },
    { savePaymentMethod: 'none' },
  ])('rejects a wallet agreement without off-session saving', async policy => {
    const { api, fetcher } = client({})
    const walletAgreement = { type: 'automatic_reload', description: 'Top-up', managementUrl: 'https://shop.example/billing',
      automaticReload: { amount: 2000, thresholdAmount: 500 } }
    await expect(api.payments.create({ ...input, customerReference: 'buyer-42', ...policy, walletAgreement } as never))
      .rejects.toBeInstanceOf(TapayaValidationError)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('forwards a wallet agreement for an off-session save', async () => {
    const { api, fetcher } = client({})
    const walletAgreement = { type: 'recurring' as const, description: 'Pro plan', managementUrl: 'https://shop.example/billing',
      recurring: { amount: 990, interval: 'week' as const, intervalCount: 2 } }
    // Only the request matters here; the empty response fails to parse.
    await api.payments.create({ ...input, customerReference: 'buyer-42', savePaymentMethod: 'optional', paymentMethodUsage: 'off_session', walletAgreement })
      .catch(() => undefined)
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({ walletAgreement })
  })
  it('forwards saving terms and returns consent evidence', async () => {
    const savingTerms = { text: 'Save my card for Pro plan renewals.', url: 'https://shop.example/terms' }
    const { api, fetcher } = client({})
    await expect(api.checkout.sessions.create({ ...input, customerReference: 'buyer-42', savePaymentMethod: 'required', savingTerms }))
      .rejects.toBeInstanceOf(TapayaValidationError)
    expect(fetcher).not.toHaveBeenCalled()
    await api.checkout.sessions.create({ ...input, locale: 'en', customerReference: 'buyer-42', savePaymentMethod: 'required', savingTerms }).catch(() => undefined)
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({ savingTerms })
    const consent = { type: 'checkbox', acceptedAt: method.createdAt, wordingVersion: 'save-card-v1', savingTerms, ipAddress: '203.0.113.7', userAgent: 'Shopper/1.0' }
    expect(await client({ ...method, consent }).api.paymentMethods.get(method.id)).toEqual({ ...method, consent })
  })
  it.each([
    { savePaymentMethod: 'none', savingTerms: { url: 'https://shop.example/terms' } },
    { savePaymentMethod: 'optional', savingTerms: { url: 'http://shop.example/terms' } },
    { savePaymentMethod: 'optional', savingTerms: {} },
  ])('rejects invalid saving terms before sending a request', async policy => {
    const { api, fetcher } = client({})
    await expect(api.payments.create({ ...input, customerReference: 'buyer-42', ...policy } as never)).rejects.toBeInstanceOf(TapayaValidationError)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects unsupported update fields and invalid page sizes', async () => {
    const { api, fetcher } = client({})
    await expect(api.paymentMethods.update(method.id, { usage: 'off_session' } as never)).rejects.toBeInstanceOf(TapayaValidationError)
    await expect(api.paymentMethods.list({ customerReference: 'buyer-42', limit: 101 })).rejects.toBeInstanceOf(TapayaValidationError)
    expect(fetcher).not.toHaveBeenCalled()
  })
})

it('creates a zero-amount verification and forwards optional consent on server confirmation', async () => {
  const response = { id: method.source.id, ...input, amount: 0, status: 'ready', retryAllowed: false, clientSecret: null, paymentMethodId: null }
  const { api, fetcher } = client(response)
  const verification = { ...input, amount: 0, mode: 'embedded' as const, customerReference: 'buyer-42', savePaymentMethod: 'required' as const }
  expect(await api.checkout.sessions.create(verification)).toMatchObject({ amount: 0 })
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({ amount: 0, savePaymentMethod: 'required' })
  fetcher.mockResolvedValueOnce(Response.json({ ...response, createdAt: method.createdAt }))
  expect(await api.payments.create({ ...input, amount: 0, customerReference: 'buyer-42', savePaymentMethod: 'required' })).toMatchObject({ amount: 0 })
  await api.checkout.sessions.confirm(response.id, 'tok_example', { saveCard: true })
  expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toMatchObject({ token: 'tok_example', saveCard: true })
  for (const invalid of [{ ...verification, savePaymentMethod: 'optional' }, { ...verification, shippingOptions: {} }]) {
    await expect(api.checkout.sessions.create(invalid as never)).rejects.toBeInstanceOf(TapayaValidationError)
  }
  expect(fetcher).toHaveBeenCalledTimes(3)
})
