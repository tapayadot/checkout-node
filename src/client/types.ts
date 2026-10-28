import type { DeclineReason, EmbeddedCheckoutSession } from '../index.js'
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

/**
 * Future charges the shopper accepts in the Apple Pay sheet when saving for off-session use. Amounts are in minor units
 * of the payment currency. Apple Pay saves off-session only with an agreement.
 */
export type WalletAgreement = {
  /** `recurring` for subscriptions or `automatic_reload` for top-ups. */
  type: 'recurring' | 'automatic_reload'
  /** What the shopper agrees to, such as "Pro plan". */
  description: string
  /** HTTPS page where the shopper manages or cancels the agreement, on an allowed checkout website. */
  managementUrl: string
  recurring?: { amount: number; interval: 'day' | 'week' | 'month' | 'year'; intervalCount?: number; startDate?: string | null } | null
  automaticReload?: { amount: number; thresholdAmount: number } | null
}

/** Your consent wording and terms link, shown with the saving checkbox or disclosure and recorded with the consent. */
export type SavingTerms = {
  /** Replaces the default checkbox label or disclosure, in the checkout language. At most 1000 characters. */
  text?: string | null
  /** HTTPS page with your full terms, on an allowed checkout website. */
  url?: string | null
}

export type PaymentStatus = 'ready' | 'successful' | 'authorized' | 'declined' | 'pending' | 'action_required' | 'cancelled'

/** Tapaya's authoritative outcome. `ready` guarantees that no charge is in flight. */
export type PaymentResult = {
  status: PaymentStatus
  /** Absent for `ready` before a payment exists, and when only your server can read the payment. */
  paymentId?: string
  /** Only Tapaya can authorize another attempt after a decline. */
  retryAllowed: boolean
  /** Contact details returned by the wallet, for checkout presentation. Never proof of payment. */
  walletContact?: {
    method: 'apple_pay' | 'google_pay'
    customer: Pick<import('../index.js').CheckoutCustomer, 'email' | 'name' | 'phone' | 'billingAddress'>
  }
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
  | 'authorized'
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
  /** Latest server-approved delivery total, for updating the merchant page's order summary and Pay label. */
  shippingQuote?: ShippingQuoteChangeEvent
  /** Selected payment option. Wallets are authorized with their own branded button. */
  paymentMethod?: 'card' | 'apple_pay' | 'google_pay'
  state: PaymentState
  outcome: PaymentOutcome
  busy: boolean
  /** Orchestration readiness. It does not require the shopper to have filled the fields. */
  canSubmit: boolean
  /** Every field is filled and none reports a validation error. */
  complete: boolean
  result?: PaymentResult
  error?: { code: PaymentErrorCode; message: string; details?: Record<string, string | number> }
}

/**
 * Stable error codes. Show `message` to the shopper and branch on `code`. New codes may be added, so keep a default.
 *
 * Fixable by the shopper, never submitted: `cardholder_required`, `card_invalid`, `customer_details_invalid`,
 * `shipping_address_incomplete`, `shipping_option_required`, `shipping_unavailable`, `shipping_changed`,
 * `shipping_total_changed`, `shipping_quote_failed`.
 * Integration mismatches, never submitted: `currency_mismatch` and `amount_mismatch` (wallet options differ from the
 * payment; `details` has `expected` and `actual`).
 * Wallets: `wallet_unavailable`, `wallet_button`, `wallet_session_ended`, `wallet_authorization_failed`.
 * Card processing: `tokenization`, `authentication`.
 */
export type PaymentErrorCode =
  | 'cardholder_required' | 'card_invalid' | 'customer_details_invalid'
  | 'shipping_address_incomplete' | 'shipping_option_required' | 'shipping_unavailable' | 'shipping_changed'
  | 'shipping_total_changed' | 'shipping_quote_failed' | 'shipping'
  | 'currency_mismatch' | 'amount_mismatch'
  | 'wallet_unavailable' | 'wallet_button' | 'wallet_session_ended' | 'wallet_authorization_failed'
  | 'tokenization' | 'authentication'
  | 'access_ended' | 'submission_uncertain' | 'recovery' | 'unavailable' | 'payment' | 'payment_creation'
  | 'configuration' | 'client_secret' | 'container' | 'not_mounted' | 'not_ready' | 'load' | 'environment'
  | 'network' | 'invalid_response' | 'frame'
  | 'no_next_action' | 'http_404'
  | (string & {})

export type PaymentLabels = {
  /** Short save-card checkbox label, used for both saving usages. */
  saveCardOnSession?: string
  /** Additional disclosure beneath the label for future merchant-initiated charges. */
  saveCardOffSession?: string
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
  /** Shown when the wallet passed as `paymentMethod` cannot be used. Card entry stays hidden. */
  walletUnavailable: string
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

/**
 * Official Apple Pay and Google Pay button types, such as "Buy with" or "Check out with".
 * The wallets draw and translate the text; branded buttons cannot show custom text or the amount.
 */
export type WalletButtonType = 'plain' | 'buy' | 'pay' | 'checkout' | 'order' | 'book' | 'donate' | 'subscribe'

/**
 * Official wallet button colors. Use `black` on light backgrounds, `white` on dark ones, and
 * `white-outline` on white or light backgrounds with little contrast. Google Pay draws `white` for both white styles.
 */
export type WalletButtonColor = 'black' | 'white' | 'white-outline'

export type Appearance = {
  variables?: Partial<AppearanceVariables>
  /**
   * The provider draws the brand logo at a fixed 32×24 px; it can be moved or hidden,
   * not resized. Applied when the fields mount; `update()` does not change it.
   */
  cardBrandIcon?: CardBrandIcon
  /**
   * Text on the official wallet buttons. Defaults to `plain`, the logo only. Apple Pay has no
   * `pay` type and shows `plain` instead. Applied when the fields mount; `update()` does not change it.
   */
  walletButtonType?: WalletButtonType
  /** Wallet button color. Defaults to `black`. Applied when the fields mount; `update()` does not change it. */
  walletButtonColor?: WalletButtonColor
  /**
   * Wallet button corner radius in CSS pixels, from 0 (square) to 24 (pill). Defaults to 8. Match it to
   * your other buttons. Applied when the fields mount; `update()` does not change it.
   */
  walletButtonRadius?: number
}

/**
 * Your prepare endpoint's response. `clientSecret` is `null` once browser access has ended; `status`
 * then reports the outcome only your server can still read.
 */
export type PreparedPayment = {
  clientSecret: string | null
  status?: EmbeddedCheckoutSession['status']
  /** Include for manual capture so completed checkout preserves the authorization outcome after browser access ends. */
  paymentStatus?: EmbeddedCheckoutSession['paymentStatus']
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
  /** Show saving controls before a lazily created payment exists. The payment's policy is checked again before confirmation. Override wording through labels. */
  cardSaving?: {
    savePaymentMethod: 'optional' | 'required'
    paymentMethodUsage?: 'on_session' | 'off_session'
    /** The payment's wallet agreement, needed to save Apple Pay for off-session use. */
    walletAgreement?: WalletAgreement | null
    /** The payment's saving terms. Shown before the payment exists and checked against it before confirmation. */
    savingTerms?: SavingTerms | null
  }
  /** Notify your backend to approve this revision, then resolve. Browser return values cannot set the total. */
  onShippingAddressChange?: (event: ShippingChangeEvent) => Promise<void>
  onShippingOptionChange?: (event: ShippingChangeEvent) => Promise<void>
  onShippingQuoteChange?: (event: ShippingQuoteChangeEvent) => void
  /**
   * Render only this method when the merchant owns the payment selector. An unavailable wallet
   * shows an error instead of card entry and reports `wallet_unavailable` in `snapshot.error`
   * while another payment is safe to start.
   */
  paymentMethod?: 'card' | 'apple_pay' | 'google_pay'
  /** Show available wallets for this total, in minor units. Omit or pass null to keep card entry only. */
  wallets?: WalletOptions | null
  /** Validate your checkout and reserve its payment when a wallet is clicked, never on mount. */
  onWalletClick?: () => Promise<string | PreparedPayment>
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

export type WalletOptions = {
  amount: number
  currency: string
  /** Collection hint when opening a wallet before prepare finishes. The server policy remains authoritative. */
  customerCollection?: import('../index.js').CustomerCollection
  /** Set when a wallet can open before prepare returns the server's shipping policy. */
  shippingRequired?: boolean
  /** Keep the branded button visible but prevent opening the wallet until checkout is valid. */
  disabled?: boolean
}

export type ShippingChangeEvent = {
  paymentId: string
  revision: number
  address: import('../index.js').CheckoutContactAddress
  selectedOptionId: string | null
}

export type ShippingQuoteChangeEvent = {
  paymentId: string
  revision: number
  amount: number
  shipping: number
  tax: number | null
  currency: string
}

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
  update(options: { appearance?: Appearance; wallets?: WalletOptions | null }): void
  /** Remove the frame. Does not cancel an accepted payment or issuer challenge. */
  destroy(): void
}

export type HandleNextActionOptions = {
  /** The `action_required` payment's `clientSecret` from your server. Keep it in memory only. */
  clientSecret: string
}

/** Status after `handleNextAction`. Read the payment on your server before fulfilling the order. */
export type NextActionStatus = 'successful' | 'authorized' | 'declined' | 'pending' | 'action_required' | 'cancelled'

/**
 * Outcome of `handleNextAction`. A decline resolves; it does not reject. `action_required` means the shopper
 * did not complete verification or confirmation: call `handleNextAction` again to retry the same payment.
 * `pending`: the outcome is not known yet; read the payment on your server. `cancelled`: the action expired.
 */
export type NextActionResult = {
  status: NextActionStatus
  paymentId: string
  /** Whether the outcome permits retrying. After do-not-retry, use another card for this order. */
  retryAllowed: boolean
  /** Set when `status` is `declined`. */
  declineReason?: DeclineReason
  /** For unfinished actions: `authentication_failed` for verification, `confirmation_failed` for confirmation. */
  error?: { code: string; message: string }
}

export interface Payments {
  readonly version: string
  createPayment(options?: PaymentOptions): Payment
  /**
   * Complete an `action_required` saved-card payment in your page. Tapaya's
   * secure frame runs 3-D Secure in a cancellable modal over your page, including for frictionless approvals.
   * Tapaya then charges the card once and this resolves with the outcome.
   *
   * Rejects with `PaymentError` only when Tapaya.js cannot handle the payment: an invalid client secret
   * (`client_secret`), an unknown, revoked or merchant-initiated payment (`http_404`), a payment without an action
   * (`no_next_action`), or a network or frame failure. When `error.submitted` is true the card may have been charged:
   * read the payment on your server before offering another attempt.
   */
  handleNextAction(options: HandleNextActionOptions): Promise<NextActionResult>
}

export type LoadOptions = {
  /** Origin that hosts Tapaya.js. Defaults to https://js.tapaya.com. */
  origin?: string
  /** Tapaya API origin, from `configuration().apiOrigin` on your server. Required: publishable keys do not identify the environment. */
  apiOrigin?: string
}
