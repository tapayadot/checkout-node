import type { PaymentErrorCode } from './types.js'

export class PaymentError extends Error {
  constructor(
    public readonly code: PaymentErrorCode,
    message: string,
    /** True when a charge may have been submitted. Check the status before paying again. */
    public readonly submitted = false,
    /** Non-sensitive debugging values, such as `{ expected: 'EUR', actual: 'CZK' }` for `currency_mismatch`. */
    public readonly details?: Record<string, string | number>,
  ) {
    super(message)
    this.name = 'PaymentError'
  }
}

/**
 * The hosted Tapaya.js bundle carries its own copy of `PaymentError`, so its errors fail `instanceof` against this
 * package's class. Rebuild them structurally, keeping code, message, `submitted`, and diagnostic details. Other errors pass unchanged.
 * Structural on purpose: the bundle's class may also come from another realm.
 */
export function toPaymentError(error: unknown): unknown {
  if (error instanceof PaymentError || error === null || typeof error !== 'object') return error
  const { name, code, message, submitted, details } = error as { name?: unknown, code?: unknown, message?: unknown, submitted?: unknown, details?: unknown }
  if (name !== 'PaymentError' || typeof code !== 'string' || typeof message !== 'string') return error
  const entries = details && typeof details === 'object' && !Array.isArray(details)
    ? Object.entries(details).filter(([, value]) => typeof value === 'string' || typeof value === 'number' && Number.isFinite(value))
    : []
  return new PaymentError(code, message, submitted === true, entries.length ? Object.fromEntries(entries) : undefined)
}
