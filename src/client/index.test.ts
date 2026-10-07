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
    vi.fn(() => ({ version, createPayment: vi.fn() })),
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
  const factory = Object.assign(vi.fn(), { version: '0.1.0' })
  window.Tapaya = factory as never
  const { loadTapaya } = await import('./index.js')
  await loadTapaya(KEY)
  expect(factory).toHaveBeenCalledWith(KEY, { apiOrigin: undefined })
  expect(document.head.querySelector('script')).toBeNull()
})

it('loads the hosted script from the versioned path once', async () => {
  const factory = serve('0.1.3')
  const { loadTapaya } = await import('./index.js')
  await Promise.all([loadTapaya(KEY), loadTapaya(KEY, { apiOrigin: 'http://localhost:3010' })])
  const appended = vi.mocked(document.head.appendChild).mock.calls
  expect(appended).toHaveLength(1)
  expect((appended[0][0] as HTMLScriptElement).src).toBe('https://js.tapaya.com/checkout/0.1.0/checkout.js')
  expect(factory).toHaveBeenLastCalledWith(KEY, { apiOrigin: 'http://localhost:3010' })
})

it('refuses an incompatible hosted version and insecure origins', async () => {
  serve('0.2.0')
  const { loadTapaya } = await import('./index.js')
  await expect(loadTapaya(KEY)).rejects.toMatchObject({ code: 'load' })
  await expect(loadTapaya(KEY, { origin: 'http://cdn.example' })).rejects.toMatchObject({ code: 'configuration' })
})

it('supports a local asset server', async () => {
  serve('0.1.0')
  const { loadTapaya } = await import('./index.js')
  await loadTapaya(KEY, { origin: 'http://localhost:4191' })
  expect((vi.mocked(document.head.appendChild).mock.calls[0][0] as HTMLScriptElement).src).toBe(
    'http://localhost:4191/checkout/0.1.0/checkout.js',
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

  const factory = serve('0.1.3')
  await expect(loadTapaya(KEY)).resolves.toMatchObject({ version: '0.1.3' })
  expect(factory).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('refuses a hosted release older than the required script version', async () => {
  serve('0.0.9')
  const { loadTapaya } = await import('./index.js')
  await expect(loadTapaya(KEY)).rejects.toMatchObject({ code: 'load' })
})
