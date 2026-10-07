import type { EmbeddedCheckoutSession } from '../index.js'
import type { PaymentError } from './errors.js'

declare global {
  interface Window {
    Tapaya?: {
      (publishableKey: string, options?: Pick<LoadOptions, 'apiOrigin'>): Payments
      version: string
      PaymentError: typeof PaymentError
    }
  }
}

export type PaymentStatus = 'ready' | 'successful' | 'declined' | 'pending' | 'action_required' | 'cancelled'

/** Tapaya's authoritative outcome. `ready` guarantees that no charge is in flight. */
export type PaymentResult = {
  status: PaymentStatus
  /** Absent for `ready` before a payment exists, and when only your server can read the payment. */
  paymentId?: string
  /** Only Tapaya can authorize another attempt after a decline. */
  retryAllowed: boolean
}

export type PaymentState =
  | 'unmounted'
  | 'loading'
  | 'ready'
  | 'preparing'
  | 'tokenizing'
  | 'authenticating'
  | 'submitting'
  | 'recovering'
  | 'successful'
  | 'declined'
  | 'pending'
  | 'action_required'
  | 'cancelled'
  | 'error'
  | 'destroyed'

/**
 * What your page should do next. `open`: show the Pay button. `pending`: show progress; the SDK
 * checks the status automatically. `completed`: open your confirmation page, which verifies the
 * order on your server. `ended`: no further attempt is allowed; offer a new checkout.
 */
export type PaymentOutcome = 'open' | 'pending' | 'completed' | 'ended'

export type PaymentSnapshot = {
  state: PaymentState
  outcome: PaymentOutcome
  busy: boolean
  /** Orchestration readiness. It does not require the shopper to have filled the fields. */
  canSubmit: boolean
  /** Every field is filled and none reports a validation error. */
  complete: boolean
  result?: PaymentResult
  error?: { code: string; message: string }
}

export type PaymentLabels = {
  cardholder: string
  number: string
  expiry: string
  cvc: string
  frameTitle: string
  cardholderRequired: string
  /** Shown when the provider rejects an incomplete or invalid card number, expiry or CVC. */
  cardInvalid: string
  /** Shown when the card fields cannot load. Nothing has been charged. */
  unavailable: string
  loading: string
  preparing: string
  tokenizing: string
  authenticating: string
  submitting: string
  recovering: string
  successful: string
  /** A decline Tapaya allows another attempt for. */
  declined: string
  /** A decline that ends this payment. Your page should offer the shopper a way forward. */
  declinedFinal: string
  pending: string
  action_required: string
  cancelled: string
  error: string
}

/**
 * Provider-neutral theme. Values are CSS values applied inside the secure frame.
 * Map them from your own input styles so the card fields match the rest of your form.
 */
export type AppearanceVariables = {
  /** Text typed into the fields. */
  colorText: string
  /** Status messages. */
  colorTextSecondary: string
  colorPlaceholder: string
  colorLabel: string
  /** Field background. */
  colorBackground: string
  colorBorder: string
  /** Invalid field borders, invalid text and error messages. */
  colorDanger: string
  /** Focus outline. */
  colorFocus: string
  borderRadius: string
  /** System or generic font stacks. Web fonts from the host page do not cross into the frame. */
  fontFamily: string
  /** Text typed into the fields. Values below 16px make iOS zoom into a focused field. */
  fontSizeBase: string
  fontSizeLabel: string
  fontWeightLabel: string
  fieldHeight: string
  /** Horizontal padding inside each field. */
  fieldPadding: string
  /** Between a label and its field. */
  spacingLabel: string
  /** Between fields in a row. */
  spacing: string
  /** Between rows of fields. */
  spacingRow: string
}

/** Where the detected card brand logo sits in the card number field. */
export type CardBrandIcon = 'left' | 'right' | 'none'

export type Appearance = {
  variables?: Partial<AppearanceVariables>
  /**
   * The provider draws the brand logo at a fixed 32×24 px; it can be moved or hidden,
   * not resized. Applied when the fields mount; `update()` does not change it.
   */
  cardBrandIcon?: CardBrandIcon
}

/**
 * Your prepare endpoint's response. `clientSecret` is `null` once browser access has ended; `status`
 * then reports the outcome only your server can still read.
 */
export type PreparedPayment = {
  clientSecret: string | null
  status?: EmbeddedCheckoutSession['status']
}

/**
 * A same-origin URL that is POSTed with cookies and no body, or a function. Either returns the
 * order's current payment, as `{ clientSecret, status }` or a client secret string.
 */
export type PrepareSource = string | (() => Promise<string | PreparedPayment>)

/**
 * A client secret, or a function that creates the payment on your server when the shopper pays,
 * for example together with the order. It returns the secret or `{ clientSecret, status }`.
 */
export type ClientSecretSource = string | (() => Promise<string | PreparedPayment>)

export type PaymentOptions = {
  /**
   * Your endpoint that returns the order's payment. Called when the fields mount, to resume a
   * payment after a reload, and on each submission, to get the next attempt after a decline.
   */
  prepare?: PrepareSource
  /** Resume a known payment instead of calling `prepare` on mount. */
  clientSecret?: string
  /** BCP 47 language tag for the secure frame. */
  locale?: string
  labels?: Partial<PaymentLabels>
  appearance?: Appearance
  onChange?: (snapshot: PaymentSnapshot) => void
}

export type SubmitOptions = { clientSecret?: ClientSecretSource }

/** A same-origin payment endpoint, or an existing secret/custom request. */
export type SubmitInput = string | SubmitOptions

export interface Payment {
  /** Current secret, including one supplied to submit(). Keep in memory only; never log or persist it. */
  readonly clientSecret: string | undefined
  readonly snapshot: PaymentSnapshot
  subscribe(listener: (snapshot: PaymentSnapshot) => void): () => void
  /** Mount the secure frame into an empty element. */
  mount(target: string | HTMLElement): Promise<void>
  /**
   * Pay with the `prepare` option, a same-origin URL, or explicit options. Pending payments only
   * check status.
   */
  submit(input?: SubmitInput): Promise<PaymentResult>
  /**
   * Check the current payment's status now. Never creates a charge. Pending payments are already
   * checked automatically while the page is visible.
   */
  recover(): Promise<PaymentResult>
  /**
   * Restyle the mounted fields without clearing them, for example at a breakpoint.
   * Text colors, font and size are fixed once the fields mount.
   */
  update(options: { appearance?: Appearance }): void
  /** Remove the frame. Does not cancel an accepted payment or issuer challenge. */
  destroy(): void
}

export interface Payments {
  readonly version: string
  createPayment(options?: PaymentOptions): Payment
}

export type LoadOptions = {
  /** Origin that hosts Tapaya.js. Defaults to https://js.tapaya.com. */
  origin?: string
  /** Tapaya API origin, from `configuration().apiOrigin` on your server. Required: publishable keys do not identify the environment. */
  apiOrigin?: string
}
