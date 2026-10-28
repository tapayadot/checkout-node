// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const KEY = `pk_dev_${'0'.repeat(32)}`
beforeEach(() => {
  vi.resetModules()
  delete window.Tapaya
  document.head.replaceChildren()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function serve(version: string) {
  const factory = Object.assign(
    vi.fn(() => ({ version, createPayment: vi.fn(), handleNextAction: vi.fn() })),
    { version },
  )
  vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
    window.Tapaya = factory as never
    queueMicrotask(() => node.dispatchEvent(new Event('load')))
    return node
  })
  return factory
}

it('reuses an already loaded Tapaya global', async () => {
  const factory = Object.assign(vi.fn(() => ({ version: '0.3.0', createPayment: vi.fn(), handleNextAction: vi.fn() })), { version: '0.3.0' })
  window.Tapaya = factory as never
  const { loadTapaya } = await import('./index.js')
  await loadTapaya(KEY)
  expect(factory).toHaveBeenCalledWith(KEY, { apiOrigin: undefined })
  expect(document.head.querySelector('script')).toBeNull()
})

it('loads the hosted script from the versioned path once', async () => {
  const factory = serve('0.3.3')
  const { loadTapaya } = await import('./index.js')
  await Promise.all([loadTapaya(KEY), loadTapaya(KEY, { apiOrigin: 'http://localhost:3010' })])
  const appended = vi.mocked(document.head.appendChild).mock.calls
  expect(appended).toHaveLength(1)
  expect((appended[0][0] as HTMLScriptElement).src).toBe('https://js.tapaya.com/checkout/0.3.0/checkout.js')
  expect(factory).toHaveBeenLastCalledWith(KEY, { apiOrigin: 'http://localhost:3010' })
})

it.each(['0.1.0', '0.2.0', '0.4.0', '0.5.0'])('refuses incompatible hosted version %s and insecure origins', async (version) => {
  serve(version)
  const { loadTapaya } = await import('./index.js')
  await expect(loadTapaya(KEY)).rejects.toMatchObject({ code: 'load' })
  await expect(loadTapaya(KEY, { origin: 'http://cdn.example' })).rejects.toMatchObject({ code: 'configuration' })
})

it('supports a local asset server', async () => {
  serve('0.3.0')
  const { loadTapaya } = await import('./index.js')
  await loadTapaya(KEY, { origin: 'http://localhost:4191' })
  expect((vi.mocked(document.head.appendChild).mock.calls[0][0] as HTMLScriptElement).src).toBe(
    'http://localhost:4191/checkout/0.3.0/checkout.js',
  )
})

it('times out a stalled script and allows a fresh load', async () => {
  vi.useFakeTimers()
  const { loadTapaya } = await import('./index.js')
  const first = loadTapaya(KEY)
  const rejection = expect(first).rejects.toMatchObject({ code: 'load' })
  const script = document.head.querySelector('script')!
  await vi.advanceTimersByTimeAsync(20_000)
  await rejection
  expect(script.isConnected).toBe(false)
  expect(vi.getTimerCount()).toBe(0)

  const factory = serve('0.3.3')
  await expect(loadTapaya(KEY)).resolves.toMatchObject({ version: '0.3.3' })
  expect(factory).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('refuses a hosted release older than the required script version', async () => {
  serve('0.2.9')
  const { loadTapaya } = await import('./index.js')
  await expect(loadTapaya(KEY)).rejects.toMatchObject({ code: 'load' })
})

it('refuses an already loaded 0.2.0 release, which cannot handle next actions', async () => {
  window.Tapaya = Object.assign(vi.fn(), { version: '0.2.0' }) as never
  const { loadTapaya } = await import('./index.js')
  await expect(loadTapaya(KEY)).rejects.toMatchObject({ code: 'configuration', message: expect.stringContaining('0.3.0') })
})

it('rebuilds errors of the hosted bundle as this package\'s PaymentError', async () => {
  // The hosted bundle has its own copy of the class: same shape, different constructor.
  class BundledPaymentError extends Error {
    override name = 'PaymentError'
    constructor(readonly code: string, message: string, readonly submitted = false) {
      super(message)
    }
  }
  const failing = {
    get clientSecret() { return 'secret' },
    snapshot: { state: 'ready' },
    mount: () => Promise.reject(new BundledPaymentError('unavailable', 'Card payment is unavailable.')),
    submit: () => Promise.reject(new BundledPaymentError('network', 'Payment status is unknown.', true)),
    recover: vi.fn(), subscribe: vi.fn(), update: () => { throw new BundledPaymentError('destroyed', 'Destroyed.') }, destroy: vi.fn(),
  }
  window.Tapaya = Object.assign(vi.fn(() => ({
    version: '0.3.0',
    createPayment: () => failing,
    handleNextAction: () => Promise.reject(new BundledPaymentError('network', 'Payment status is unknown.', true)),
  })), { version: '0.3.0' }) as never
  const { loadTapaya, PaymentError } = await import('./index.js')
  const tapaya = await loadTapaya(KEY)
  const nextAction = await tapaya.handleNextAction({ clientSecret: 'x' }).catch((caught: unknown) => caught)
  expect(nextAction).toBeInstanceOf(PaymentError)
  expect(nextAction).toMatchObject({ code: 'network', message: 'Payment status is unknown.', submitted: true })
  const payment = tapaya.createPayment()
  expect(payment.clientSecret).toBe('secret')
  await expect(payment.mount('#x')).rejects.toBeInstanceOf(PaymentError)
  await expect(payment.submit()).rejects.toMatchObject({ code: 'network', submitted: true })
  expect(() => payment.update({})).toThrow(PaymentError)
  // Unrelated errors pass through unchanged.
  const { toPaymentError } = await import('./errors.js')
  const plain = new TypeError('boom')
  expect(toPaymentError(plain)).toBe(plain)
})

it('preserves flat diagnostic details when converting a hosted error', async () => {
  const { toPaymentError, PaymentError } = await import('./errors.js')
  const error = toPaymentError({
    name: 'PaymentError', code: 'currency_mismatch', message: 'Currency differs.', submitted: false,
    details: { expected: 'EUR', actual: 'CZK', revision: 2, nested: { token: 'private' }, invalid: NaN },
  })
  expect(error).toBeInstanceOf(PaymentError)
  expect(error).toMatchObject({ details: { expected: 'EUR', actual: 'CZK', revision: 2 } })
  expect((error as InstanceType<typeof PaymentError>).details).not.toHaveProperty('nested')
  expect((error as InstanceType<typeof PaymentError>).details).not.toHaveProperty('invalid')
})
