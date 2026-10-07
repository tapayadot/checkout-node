import { PaymentError } from './errors.js'
import type { LoadOptions, Payments } from './types.js'
import { SCRIPT_VERSION, MIN_SCRIPT_VERSION } from './version.js'
export { PaymentError } from './errors.js'
export type * from './types.js'

const DEFAULT_ORIGIN = 'https://js.tapaya.com'
const loading = new Map<string, Promise<NonNullable<Window['Tapaya']>>>()

function scriptUrl(origin = DEFAULT_ORIGIN): string {
  const url = new URL(origin)
  const loopback = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !loopback) || url.pathname !== '/' || url.search || url.hash || url.username)
    throw new PaymentError('configuration', 'Invalid Tapaya.js origin.')
  return `${url.origin}/checkout/${SCRIPT_VERSION}/checkout.js`
}

/** Same major and minor release line as MIN_SCRIPT_VERSION, and no older. */
function compatible(version: unknown): boolean {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return false
  const [major, minor, patch] = version.split('.').map(Number)
  const [minMajor, minMinor, minPatch] = MIN_SCRIPT_VERSION.split('.').map(Number)
  return major === minMajor && minor === minMinor && patch >= minPatch
}

function inject(src: string): Promise<NonNullable<Window['Tapaya']>> {
  const existing = window.Tapaya
  if (existing)
    return compatible(existing.version)
      ? Promise.resolve(existing)
      : Promise.reject(
          new PaymentError(
            'configuration',
            `Tapaya.js ${existing.version} is already loaded; this package needs ${MIN_SCRIPT_VERSION} or newer in the same release line.`,
          ),
        )
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    const cleanup = () => {
      window.clearTimeout(timer)
      script.removeEventListener('error', fail)
      script.removeEventListener('load', ready)
    }
    const fail = () => {
      cleanup()
      script.remove()
      reject(new PaymentError('load', 'Tapaya.js could not load.'))
    }
    const ready = () => {
      const loaded = window.Tapaya
      if (loaded && compatible(loaded.version)) {
        cleanup()
        resolve(loaded)
      } else fail()
    }
    const timer = window.setTimeout(fail, 20_000)
    script.addEventListener('error', fail, { once: true })
    script.addEventListener('load', ready, { once: true })
    document.head.appendChild(script)
  })
}

/**
 * Load Tapaya.js from Tapaya's CDN and initialize it with a publishable key.
 * The payment logic is always served by Tapaya, so compatible fixes need no redeploy.
 */
export function loadTapaya(publishableKey: string, options: LoadOptions = {}): Promise<Payments> {
  if (typeof window === 'undefined')
    return Promise.reject(new PaymentError('environment', 'Load payments in a browser.'))
  let src: string
  try {
    src = scriptUrl(options.origin)
  } catch (error) {
    return Promise.reject(error)
  }
  let pending = loading.get(src)
  if (!pending) {
    pending = inject(src)
    loading.set(src, pending)
    pending.catch(() => loading.delete(src))
  }
  return pending.then((factory) => factory(publishableKey, { apiOrigin: options.apiOrigin }))
}
