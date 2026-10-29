import { createHmac } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { Tapaya, TapayaPayments, TapayaValidationError, verifyShippingQuoteSignature } from './index.js'

const option = { id: 'standard', label: 'Standard', price: 300, amount: 1500, tax: 200, countries: ['CZ'] }
const address = { line1: 'Street 1', city: 'Prague', country: 'CZ' }
const quote = { dynamic: true, revision: 1, status: 'approved', options: [option], selectedOptionId: 'standard',
  expiresAt: Math.floor(Date.now() / 1000) + 300, error: null, address }
const payment = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', merchantOrderId: 'order-1', amount: 1500, currency: 'EUR',
  status: 'ready', retryAllowed: false, clientSecret: `${'a'.repeat(32)}_secret_v1_${'b'.repeat(43)}`, shippingQuote: quote }

it('sends shipping policies and preserves quotes and delivery addresses through payment reads', async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ ...payment, customer: { shippingAddress: address } }))
  const client = new TapayaPayments('secret', { fetch: fetcher })
  const shippingOptions = { dynamic: true, options: [option] }
  await client.prepare({ merchantOrderId: 'order-1', amount: 1200, currency: 'EUR', shippingOptions }, 'create-1')
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ amount: 1200, shippingOptions })
  expect((await client.retrieve(payment.id)).shippingQuote).toEqual(quote)
  expect((await client.findByOrder('order-1'))?.customer?.shippingAddress).toEqual(address)
})

it('approves merchant quotes and submits their revision and authorized amount', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(quote)).mockResolvedValueOnce(Response.json(payment))
  const client = new TapayaPayments('secret', { fetch: fetcher })
  const { status: _status, dynamic: _dynamic, address: _address, ...approval } = quote
  expect(await client.approveShippingQuote(payment.id, approval)).toEqual(quote)
  expect(fetcher.mock.calls[0][0]).toContain(`/merchant/payments/${payment.id}/shipping-quote`)
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(approval)
  const shippingQuote = { revision: 1, amount: 1500, address }
  await client.confirm(payment.id, 'tok_card', { shippingQuote, customer: { email: 'buyer@example.com' } })
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ token: 'tok_card', shippingQuote, customer: { email: 'buyer@example.com' } })
})

it('does not accept an approval response for another revision', async () => {
  const client = new TapayaPayments('secret', { fetch: vi.fn().mockResolvedValue(Response.json({ ...quote, revision: 2 })) })
  await expect(client.approveShippingQuote(payment.id, { revision: 1, options: [option], selectedOptionId: 'standard', expiresAt: quote.expiresAt }))
    .rejects.toThrow('revision does not match')
})

it('preserves hosted dynamic callback configuration at creation and quotes on status reads', async () => {
  const hosted = { id: 'cs_test', url: 'https://checkout.example/c/cs_test', merchantOrderId: 'order-1', amount: 1500, currency: 'EUR',
    status: 'open', paymentStatus: 'unpaid', createdAt: '2026-10-26T00:00:00Z', expiresAt: '2026-10-26T00:30:00Z', shippingQuote: quote }
  const fetcher = vi.fn().mockImplementation(async () => Response.json(hosted))
  const client = new Tapaya('secret', { fetch: fetcher }).checkout.sessions
  const shippingOptions = { dynamic: true, callbackUrl: 'https://shop.example/shipping', callbackSecret: 'x'.repeat(32) }
  expect((await client.create({ merchantOrderId: 'order-1', amount: 1200, currency: 'EUR', shippingOptions })).shippingQuote).toEqual(quote)
  expect(JSON.parse(fetcher.mock.calls[0][1].body).shippingOptions).toEqual(shippingOptions)
  expect((await client.get('cs_test')).shippingQuote).toEqual(quote)
})

it('rejects invalid option totals before sending credentials to the backend', async () => {
  const fetcher = vi.fn()
  const client = new TapayaPayments('secret', { fetch: fetcher })
  await expect(client.prepare({ merchantOrderId: 'order-1', amount: 1200, currency: 'EUR', shippingOptions: { options: [{ ...option, price: 2000 }] } }, 'key'))
    .rejects.toBeInstanceOf(TapayaValidationError)
  expect(fetcher).not.toHaveBeenCalled()
})

it('verifies hosted callback signatures against the exact body and rejects modified or malformed signatures', async () => {
  const body = JSON.stringify({ paymentId: payment.id, revision: 1, address })
  const secret = 'private callback signing secret of at least 32 characters'
  const signature = createHmac('sha256', secret).update(body).digest('hex')
  expect(await verifyShippingQuoteSignature(body, signature, secret)).toBe(true)
  expect(await verifyShippingQuoteSignature(`${body}\n`, signature, secret)).toBe(false)
  expect(await verifyShippingQuoteSignature(body, signature, `${secret}changed`)).toBe(false)
  expect(await verifyShippingQuoteSignature(body, 'not-hex', secret)).toBe(false)
})

it.each([undefined, null, 0, 200])('preserves optional shipping tax on creation, approval, and reads (%j)', async (tax) => {
  const { tax: originalTax, ...withoutTax } = option
  const selected = tax === undefined ? withoutTax : { ...withoutTax, tax }
  const approved = { ...quote, options: [selected] }
  const fetcher = vi.fn().mockImplementation(async (url: string) => Response.json(
    url.endsWith('/shipping-quote') ? approved : { ...payment, shippingQuote: approved }))
  const client = new TapayaPayments('secret', { fetch: fetcher })
  const created = await client.prepare({ merchantOrderId: 'order-1', amount: 1200, currency: 'EUR', shippingOptions: { options: [selected] } }, 'key')
  expect(created.shippingQuote?.options[0].tax).toBe(tax ?? null)
  expect(JSON.parse(fetcher.mock.calls[0][1].body).shippingOptions.options[0].tax).toBe(tax ?? null)
  const result = await client.approveShippingQuote(payment.id, { revision: 1, options: [selected], selectedOptionId: 'standard', expiresAt: quote.expiresAt })
  expect(result.options[0].tax).toBe(tax ?? null)
})

it.each([-1, 1501])('rejects shipping tax outside the final amount (%j)', async (tax) => {
  const fetcher = vi.fn()
  const client = new TapayaPayments('secret', { fetch: fetcher })
  await expect(client.prepare({ merchantOrderId: 'order-1', amount: 1200, currency: 'EUR', shippingOptions: { options: [{ ...option, tax }] } }, 'key'))
    .rejects.toBeInstanceOf(TapayaValidationError)
  expect(fetcher).not.toHaveBeenCalled()
})
