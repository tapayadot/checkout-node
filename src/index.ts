import { z } from 'zod/v4'
import type { SavingTerms, WalletAgreement } from './client/types.js'

export const VERSION = '0.4.0'

const USER_AGENT = `tapaya-checkout-js/${VERSION}`
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RETRIES = 2
const INITIAL_RETRY_DELAY_MS = 500
const MAX_RETRY_DELAY_MS = 8_000
// Longer waits would hold up the caller's request. Callers can read retryAfterMs and retry later instead.
const MAX_RETRY_AFTER_MS = 10_000
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])
const API_BASE_URLS = {
  sandbox: 'https://api.sandbox.tapaya.com',
  production: 'https://api.tapaya.com',
}
const MAX_INT32 = 2_147_483_647
// 409 error code: a request with the same Idempotency-Key is still in progress.
const IDEMPOTENCY_IN_PROGRESS = 'API-0024'

export type TapayaEnvironment = 'sandbox' | 'production'

/** A product shown on the hosted page. Items are for display only and do not change the amount charged. */
export type CheckoutItem = {
  /** Your product reference, such as a SKU. */
  reference: string
  /** Product name. */
  name: string
  /** Product description. May be empty. */
  description: string
  /** Absolute URL of the product image. */
  imageUrl: string
  /** Number of units, a positive integer. */
  quantity: number
  /** Price of one unit, in minor units. */
  unitAmount: number
}

export type TaxBreakdownEntry = {
  /** Tax rate in percentage points, such as `21`. */
  taxRate: number
  /** Tax charged at this rate, in minor units. */
  tax: number
}

export type CheckoutContactAddress = {
  /** Full name. */
  name?: string | null
  /** Phone number, such as `+420123456789`. */
  phone?: string | null
  /** First address line. */
  line1?: string | null
  /** Second address line. */
  line2?: string | null
  /** City or town. */
  city?: string | null
  /** Postal or ZIP code. */
  postalCode?: string | null
  /** State, province, or region. */
  state?: string | null
  /** ISO 3166-1 alpha-2 country code, such as `CZ`. */
  country?: string | null
}

/** Customer details to prefill. Send only the details you collect. */
export type CheckoutCustomer = {
  /** Customer email address. */
  email?: string | null
  /** Customer contact name. */
  name?: string | null
  /** Customer contact phone. */
  phone?: string | null
  /** Billing address. Send only the fields you collect. */
  billingAddress?: CheckoutContactAddress | null
  /** Shipping address. Send only the fields you collect. */
  shippingAddress?: CheckoutContactAddress | null
}

export type CustomerCollectionMode = 'none' | 'optional' | 'required'

/** Fields checkout collects. Omitted fields in an explicit policy mean none. */
export type CustomerCollection = {
  email?: CustomerCollectionMode
  name?: CustomerCollectionMode
  phone?: CustomerCollectionMode
  billingAddress?: CustomerCollectionMode
}

/** A delivery choice. All amounts are minor units. */
export type ShippingOption = {
  /** Your option ID, such as `standard`. */
  id: string
  /** Name shown to the shopper. */
  label: string
  /** Delivery charge, included in `amount`. */
  price: number
  /** Final order total when the shopper picks this option, including `price` and `tax`. This is what gets charged. */
  amount: number
  /** Tax included in `amount`. Omit or use null for unspecified VAT; zero explicitly means no VAT. */
  tax?: number | null
  /** ISO 3166-1 alpha-2 destination countries, uppercase, such as `CZ`. */
  countries: string[]
}

export type ShippingOptions = {
  /** Price delivery per address: your server approves each quote revision. Omit for the fixed `options`. */
  dynamic?: boolean
  options?: ShippingOption[]
  /** Hosted dynamic pricing only: where Tapaya posts a `ShippingQuoteRequest`. Never pass callback credentials to browser code. */
  callbackUrl?: string | null
  /** Hosted dynamic pricing only: 32 to 512 characters, for `verifyShippingQuoteSignature`. */
  callbackSecret?: string | null
}

export type ShippingQuote = {
  dynamic: boolean
  revision: number
  status: 'unquoted' | 'pending' | 'approved' | 'error' | 'accepted' | (string & {})
  options: ShippingOption[]
  selectedOptionId: string | null
  /** Unix time in seconds. */
  expiresAt: number | null
  error: string | null
  address: CheckoutContactAddress | null
}

export type ShippingQuoteApproval = {
  revision: number
  options: ShippingOption[]
  selectedOptionId: string | null
  /** Unix time in seconds. */
  expiresAt: number
  error?: 'unsupported_destination' | 'quote_error' | null
}

export type ShippingConfirmation = {
  revision: number
  amount: number
  address: CheckoutContactAddress
}

/** Body delivered to the hosted merchant callback. Verify its signature before pricing. */
export type ShippingQuoteRequest = {
  paymentId: string
  merchantOrderId: string
  currency: string
  revision: number
  address: CheckoutContactAddress
  selectedOptionId: string | null
}

/**
 * Verify X-Tapaya-Quote-Signature against the exact, unparsed UTF-8 request body. A missing header returns false, so
 * `request.headers.get('x-tapaya-quote-signature')` can be passed directly.
 */
export async function verifyShippingQuoteSignature(body: string, signature: string | null | undefined, secret: string): Promise<boolean> {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false
  const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const bytes = Uint8Array.from(signature.match(/../g)!, value => Number.parseInt(value, 16))
  return globalThis.crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(body))
}

/** Merchant-scoped saving instructions. Card details remain in Tapaya's secure fields. */
export type CardSavingOptions = {
  customerReference?: string | null
  savePaymentMethod?: 'none' | 'optional' | 'required' | null
  paymentMethodUsage?: 'on_session' | 'off_session' | null
  /** Shown in the Apple Pay sheet. Requires saving with `paymentMethodUsage: 'off_session'`; without it Apple Pay cannot save off-session. */
  walletAgreement?: WalletAgreement | null
  /** Your consent wording and terms link, shown by hosted and embedded checkout. Requires `optional` or `required` saving. Tapaya does not translate `text`; hosted sessions with `text` require `locale`. */
  savingTerms?: SavingTerms | null
}

type CheckoutSessionFields = CardSavingOptions & {
  /** Manual authorizes a card without capturing funds. Not supported with shippingOptions. */
  captureMethod?: 'automatic' | 'manual'
  /** Allow increases to a manual authorization on the same payment. */
  allowIncrementalAuthorization?: boolean
  /**
   * Your order reference, at most 200 characters. All payment attempts for this order, hosted or embedded, share it,
   * and at most one can succeed. A new session for the same unpaid order replaces the previous one.
   */
  merchantOrderId: string
  /** Final total in integer minor units. Zero requires saving a new payment method. */
  amount: number
  /** Three-letter ISO 4217 currency code, such as `EUR`. Tapaya stores it uppercase. */
  currency: string
  /** Language of the hosted page, such as `en`. Omit to use the browser language. */
  locale?: string | null
  /** Return URL after payment. Defaults to the URL in your Checkout settings. */
  successUrl?: string | null
  /** Return URL when the customer cancels. Defaults to the URL in your Checkout settings. */
  cancelUrl?: string | null
  /** Products shown on the hosted page. */
  items?: CheckoutItem[] | null
  /** Tax included in `amount`, in minor units. */
  tax?: number | null
  /** Shipping included in `amount`, in minor units. Omit or send null to hide it; zero means free shipping. */
  shipping?: number | null
  /** Customer details to prefill on the hosted page. */
  customer?: CheckoutCustomer | null
  /** Null or omission uses merchant defaults; an empty object disables collection. */
  customerCollection?: CustomerCollection | null
  /** Opt in to server-approved shipping quotes. Omission keeps the fixed creation total. */
  shippingOptions?: ShippingOptions | null
}

/** Send either `taxRate` or `taxBreakdown`, not both. */
type CheckoutSessionTaxRate =
  | {
    /** Single tax rate in percentage points, such as `21`. */
    taxRate?: number | null
    /** Tax per rate, for orders with mixed rates. Use instead of `taxRate`. */
    taxBreakdown?: null
  }
  | {
    /** Single tax rate in percentage points, such as `21`. */
    taxRate?: null
    /** Tax per rate, for orders with mixed rates. Use instead of `taxRate`. */
    taxBreakdown?: TaxBreakdownEntry[] | null
  }

export type CheckoutMode = 'hosted' | 'embedded'

export type CreateHostedCheckoutSessionParams = CheckoutSessionFields & CheckoutSessionTaxRate & {
  /** Defaults to hosted when omitted. */
  mode?: 'hosted'
}

export type CreateEmbeddedCheckoutSessionParams = CreatePayment & { mode: 'embedded' }

export type CreateCheckoutSessionParams = CreateHostedCheckoutSessionParams | CreateEmbeddedCheckoutSessionParams

/** Session status. New values may be added. */
export type CheckoutSessionStatus = 'open' | 'completed' | 'expired' | (string & {})

/** Status of the latest payment attempt. New values may be added. */
export type CheckoutPaymentStatus =
  | 'unpaid' | 'successful' | 'authorized' | 'failed' | 'cancelled' | 'action_needed' | (string & {})

export type HostedCheckoutSession = {
  paymentMethodId?: string | null
  /** Methods the hosted page offers: `card`, `apple_pay`, `google_pay`. Returned on creation. */
  paymentMethodTypes?: string[]
  mode: 'hosted'
  /** Customer snapshot returned by session status. Absent on older responses and creation. */
  customer?: CheckoutCustomer | null
  shippingQuote?: ShippingQuote | null
  /** Session ID, such as `cs_Y7u2d`. */
  id: string
  /** Hosted payment page. Redirect to it unchanged. */
  url: string
  /** Your order reference, or the one Tapaya generated. */
  merchantOrderId: string
  /** `open`, `completed`, or `expired`. Sessions expire after 30 minutes. */
  status: CheckoutSessionStatus
  /** `unpaid`, `successful`, `failed`, `cancelled`, or `action_needed`. */
  paymentStatus: CheckoutPaymentStatus
  /** Final total, in minor units. */
  amount: number
  /** ISO 4217 currency code, uppercase. */
  currency: string
  /** Tax included in `amount`, in minor units. Null when not supplied; zero explicitly means no VAT. */
  tax: number | null
  /** Shipping included in `amount`, in minor units. Null when not supplied; zero means free shipping. */
  shipping: number | null
  /** Single tax rate in percentage points, or `null` when not sent. */
  taxRate: number | null
  /** Tax per rate. Empty when not sent. */
  taxBreakdown: TaxBreakdownEntry[]
  /** Items sent when the session was created. Empty when none were sent. */
  items: CheckoutItem[]
  /** Token of the latest payment attempt, or `null` before the first attempt. */
  paymentReference: string | null
  /** ISO 8601 timestamp of when the session was created. */
  createdAt: string
  /** ISO 8601 timestamp of when the session expires. */
  expiresAt: string
  /** ISO 8601 timestamp of the successful payment, or `null` until payment succeeds. */
  completedAt: string | null
}

/** Embedded sessions use the existing merchant payment ID and lifecycle. */
export type EmbeddedCheckoutSession = Omit<MerchantPayment, 'status'> & {
  mode: 'embedded'
  url: null
  /**
   * `open` while the order can still be paid or a result is pending, `completed` once paid or authorized, and
   * `ended` after a cancellation or a decline that allows no further attempt.
   */
  status: 'open' | 'completed' | 'ended'
  paymentStatus: 'unpaid' | 'successful' | 'authorized' | 'failed' | 'pending' | 'action_needed' | 'cancelled'
}

export type CheckoutSession = HostedCheckoutSession | EmbeddedCheckoutSession

/** What your prepare endpoint returns to the browser SDK (`@tapayadot/checkout/client`). */
export type { PreparedPayment, SavingTerms, WalletAgreement } from './client/types.js'

// Create params: catch programming mistakes and leave business rules to the API.
const minorAmountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const taxBreakdownSchema = z.array(z.object({ taxRate: z.number().nonnegative(), tax: minorAmountSchema }))
const contactAddressSchema = z.object({
  name: z.string().nullish(),
  phone: z.string().nullish(),
  line1: z.string().nullish(),
  line2: z.string().nullish(),
  city: z.string().nullish(),
  postalCode: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
})

const customerSchema = z.object({
  email: z.string().nullish(),
  name: z.string().nullish(),
  phone: z.string().nullish(),
  billingAddress: contactAddressSchema.nullish(),
  shippingAddress: contactAddressSchema.nullish(),
})
const customerInputSchema = customerSchema.extend({
  email: z.string().max(254).nullish(),
  name: z.string().max(200).nullish(),
  phone: z.string().max(30).nullish(),
})
const collectionModeSchema = z.enum(['none', 'optional', 'required'])
const customerCollectionSchema = z.object({
  email: collectionModeSchema.optional(),
  name: collectionModeSchema.optional(),
  phone: collectionModeSchema.optional(),
  billingAddress: collectionModeSchema.optional(),
})
const shippingOptionSchema = z.object({
  id: z.string().min(1).max(100).refine(value => Boolean(value.trim())), label: z.string().min(1).max(200).refine(value => Boolean(value.trim())),
  price: minorAmountSchema, amount: z.number().int().positive().max(MAX_INT32), tax: minorAmountSchema.nullish().default(null),
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(250),
}).refine(option => option.price <= option.amount && (option.tax == null || option.tax <= option.amount), 'Shipping price and tax must be included in amount')
const shippingOptionsSchema = z.object({
  dynamic: z.boolean().optional(), options: z.array(shippingOptionSchema).max(50).optional(),
  callbackUrl: z.string().nullish(), callbackSecret: z.string().min(32).max(512).nullish(),
})
// A response: accept new statuses and looser options than creation allows.
const shippingQuoteSchema = z.object({
  dynamic: z.boolean(), revision: z.number().int(), status: z.string(),
  options: z.array(z.object({
    id: z.string(), label: z.string(), price: z.number(), amount: z.number(), tax: z.number().nullish().default(null), countries: z.array(z.string()),
  })),
  selectedOptionId: z.string().nullable(), expiresAt: z.number().nullable(), error: z.string().nullable(), address: contactAddressSchema.nullable(),
}) satisfies z.ZodType<ShippingQuote>
const shippingApprovalSchema = z.object({
  revision: z.number().int().positive(), options: z.array(shippingOptionSchema).max(50),
  selectedOptionId: z.string().nullable(), expiresAt: z.number().int(),
  error: z.enum(['unsupported_destination', 'quote_error']).nullish(),
})
const shippingConfirmationSchema = z.object({
  revision: z.number().int().positive(), amount: z.number().int().positive().max(MAX_INT32), address: contactAddressSchema,
})
const walletAgreementSchema = z.object({
  type: z.enum(['recurring', 'automatic_reload']),
  description: z.string().min(1).max(200),
  managementUrl: z.string().url().max(2048),
  recurring: z.object({
    amount: z.number().int().positive(), interval: z.enum(['day', 'week', 'month', 'year']),
    intervalCount: z.number().int().positive().optional(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  }).nullish(),
  automaticReload: z.object({ amount: z.number().int().positive(), thresholdAmount: z.number().int().nonnegative() }).nullish(),
}) satisfies z.ZodType<WalletAgreement>
const savingTermsSchema = z.object({
  text: z.string().max(1000).refine(value => value.trim().length > 0).nullish(),
  url: z.string().url().startsWith('https://').max(2048).nullish(),
}).refine(value => value.text != null || value.url != null, 'Supply text or url') satisfies z.ZodType<SavingTerms>
const cardSavingFields = {
  customerReference: z.string().min(1).max(200).refine(value => value.trim().length > 0).nullish(),
  savePaymentMethod: z.enum(['none', 'optional', 'required']).nullish(),
  paymentMethodUsage: z.enum(['on_session', 'off_session']).nullish(),
  walletAgreement: walletAgreementSchema.nullish(),
  savingTerms: savingTermsSchema.nullish(),
}
function validateCardSaving(value: CardSavingOptions, context: z.RefinementCtx) {
  const saving = value.savePaymentMethod ?? 'none'
  if (saving !== 'none' && !value.customerReference)
    context.addIssue({ code: 'custom', path: ['customerReference'], message: 'A customer reference is required when saving a card' })
  if (saving === 'none' && value.paymentMethodUsage != null)
    context.addIssue({ code: 'custom', path: ['paymentMethodUsage'], message: 'Enable card saving before setting usage' })
  if (value.walletAgreement != null && (saving === 'none' || value.paymentMethodUsage !== 'off_session'))
    context.addIssue({ code: 'custom', path: ['walletAgreement'], message: 'A wallet agreement requires saving with off_session usage' })
  if (value.savingTerms != null && saving === 'none')
    context.addIssue({ code: 'custom', path: ['savingTerms'], message: 'Saving terms require optional or required saving' })
}

// Only the params type allows taxRate or taxBreakdown, not both. The API enforces it at runtime.
const createSessionSchema = z.object({
  ...cardSavingFields,
  captureMethod: z.enum(['automatic', 'manual']).optional(),
  allowIncrementalAuthorization: z.boolean().optional(),
  merchantOrderId: z.string().max(200).refine((value) => value.trim().length > 0),
  amount: z.number().int().nonnegative().max(MAX_INT32),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  locale: z.string().nullish(),
  successUrl: z.string().nullish(),
  cancelUrl: z.string().nullish(),
  items: z.array(z.object({
    reference: z.string(),
    name: z.string(),
    description: z.string(),
    imageUrl: z.string(),
    quantity: z.number().int().positive().max(MAX_INT32),
    unitAmount: minorAmountSchema,
  })).nullish(),
  tax: minorAmountSchema.nullish(),
  shipping: minorAmountSchema.nullish(),
  taxRate: z.number().nonnegative().nullish(),
  taxBreakdown: taxBreakdownSchema.nullish(),
  customer: customerInputSchema.nullish(),
  customerCollection: customerCollectionSchema.nullish(),
  shippingOptions: shippingOptionsSchema.nullish(),
}).superRefine((value, context) => {
  validateCardSaving(value, context)
  if (value.amount === 0 && (value.savePaymentMethod !== 'required' || value.shippingOptions != null))
    context.addIssue({ code: 'custom', path: ['amount'], message: 'Zero-amount verification requires required saving without shipping' })
  if (value.captureMethod === 'manual' && value.shippingOptions != null)
    context.addIssue({ code: 'custom', path: ['shippingOptions'], message: 'Manual capture does not support shippingOptions' })
  if (value.allowIncrementalAuthorization && value.captureMethod !== 'manual')
    context.addIssue({ code: 'custom', path: ['captureMethod'], message: 'Incremental authorization requires manual capture' })
  // Without a locale the hosted page follows the browser and could surround the text with another language.
  if (value.savingTerms?.text != null && !value.locale?.trim())
    context.addIssue({ code: 'custom', path: ['locale'], message: 'Set locale to the language of savingTerms.text' })
}) satisfies z.ZodType<CheckoutSessionFields & { taxRate?: number | null, taxBreakdown?: TaxBreakdownEntry[] | null }>

// Responses: check only what the SDK relies on, so new values and looser data do not break callers.
const sessionSchema = z.object({
  paymentMethodTypes: z.array(z.string()).optional(),
  customer: customerSchema.nullish(),
  shippingQuote: shippingQuoteSchema.nullish(),
  paymentMethodId: z.string().nullable().optional(),
  id: z.string().min(1),
  url: z.string(),
  merchantOrderId: z.string(),
  status: z.string(),
  paymentStatus: z.string(),
  amount: z.number(),
  currency: z.string(),
  tax: z.number().nullable().default(null),
  shipping: z.number().nullable().default(null),
  taxRate: z.number().nullable().default(null),
  taxBreakdown: z.array(z.object({ taxRate: z.number(), tax: z.number() })).default([]),
  items: z.array(z.object({
    reference: z.string(),
    name: z.string(),
    description: z.string(),
    imageUrl: z.string(),
    quantity: z.number(),
    unitAmount: z.number(),
  })).default([]),
  paymentReference: z.string().nullable().default(null),
  createdAt: z.string(),
  expiresAt: z.string(),
  completedAt: z.string().nullable().default(null),
}) satisfies z.ZodType<Omit<HostedCheckoutSession, 'mode'>>

export type TapayaOptions = {
  /** Merchant identifier belonging to the organization that owns the Secret key. */
  merchantToken?: string
  /**
   * Selects the API URL when neither `baseUrl` nor `TAPAYA_BASE_URL` is set. Defaults to `TAPAYA_ENVIRONMENT`, then `production` for a
   * `tapaya_live_` key and `sandbox` otherwise. A live key outside production, or a test key in it, throws.
   */
  environment?: TapayaEnvironment
  /** Embedded API overrides. Defaults to this client's API URL, fetch and timeout. */
  embedded?: TapayaPaymentsOptions
  /** Overrides the API URL. Defaults to `TAPAYA_BASE_URL`, then the environment URL. Must use HTTPS, except for local hosts outside `NODE_ENV=production`. */
  baseUrl?: string
  /** Custom `fetch` implementation. Defaults to the global `fetch`. */
  fetch?: typeof fetch
  /** Timeout for each attempt, in milliseconds. Defaults to `30000` for hosted checkout and `35000` for embedded checkout. */
  timeoutMs?: number
  /** Hosted checkout retries after a connection error, timeout, HTTP 429, 502, 503, or 504, or a create still in progress. Defaults to `2`. Embedded checkout never retries. */
  maxRetries?: number
}

export type RequestOptions = {
  /** Selects a merchant for this request, overriding the client's merchantToken. */
  merchantToken?: string
  /** Aborts the request immediately, without retrying. The method rejects with the signal's reason. */
  signal?: AbortSignal
  /** Overrides the client's timeout for each attempt, in milliseconds. */
  timeoutMs?: number
  /** Overrides the client's retry count. */
  maxRetries?: number
}

export type CreateSessionOptions = RequestOptions & {
  /** Sent as `Idempotency-Key`, up to 250 printable ASCII characters. Defaults to a random UUID per call. */
  idempotencyKey?: string
}

export type CreateEmbeddedSessionOptions = PaymentRequestOptions & {
  /** Store and reuse this key for the checkout attempt. Defaults to a random UUID per call. */
  idempotencyKey?: string
}

export type RetrieveHostedSessionOptions = RequestOptions & { mode?: 'hosted' }
export type RetrieveEmbeddedSessionOptions = PaymentRequestOptions & { mode: 'embedded' }
export type RetrieveSessionOptions = RetrieveHostedSessionOptions | RetrieveEmbeddedSessionOptions

export type TapayaFieldError = {
  /** Parameter path, such as `customer.email`. */
  field: string
  /** Description of the problem. */
  message: string
  /** Machine-readable reason, when available. */
  code?: string
}

export class TapayaError extends Error {
  override name = 'TapayaError'
}

/** Parameters failed validation before a request was sent. */
export class TapayaValidationError extends TapayaError {
  override name = 'TapayaValidationError'

  constructor(message: string, readonly fieldErrors: TapayaFieldError[] = []) {
    super(message)
  }
}

/** The request did not reach Tapaya, or the response was lost. */
export class TapayaConnectionError extends TapayaError {
  override name = 'TapayaConnectionError'
}

export class TapayaTimeoutError extends TapayaConnectionError {
  override name = 'TapayaTimeoutError'
}

/** Tapaya responded, but the response could not be used. */
export class TapayaResponseError extends TapayaError {
  override name = 'TapayaResponseError'
  /** Request ID from the `X-Request-Id` header, for support requests. */
  readonly requestId: string | undefined

  constructor(message: string, readonly status: number, readonly headers: Headers = new Headers()) {
    super(message)
    this.requestId = headers.get('x-request-id') ?? undefined
  }
}

/** Tapaya rejected the request. Subclasses identify common statuses. */
export class TapayaApiError extends TapayaError {
  override name = 'TapayaApiError'

  /** HTTP status code. */
  readonly status: number
  /** Tapaya error code, such as `API-0022`. */
  readonly code: string | undefined
  /** Problems with individual fields, when Tapaya reports them. */
  readonly fieldErrors: TapayaFieldError[]
  /** Response headers, for debugging and support requests. */
  readonly headers: Headers
  /** Request ID from the `X-Request-Id` header, for support requests. */
  readonly requestId: string | undefined

  constructor(
    message: string,
    init: { status: number, headers: Headers, code?: string, fieldErrors?: TapayaFieldError[] },
  ) {
    super(message)
    this.status = init.status
    this.headers = init.headers
    this.requestId = init.headers.get('x-request-id') ?? undefined
    this.code = init.code
    this.fieldErrors = init.fieldErrors ?? []
  }
}

export class TapayaInvalidRequestError extends TapayaApiError {
  override name = 'TapayaInvalidRequestError'
}

export class TapayaAuthenticationError extends TapayaApiError {
  override name = 'TapayaAuthenticationError'
}

export class TapayaPermissionError extends TapayaApiError {
  override name = 'TapayaPermissionError'
}

export class TapayaNotFoundError extends TapayaApiError {
  override name = 'TapayaNotFoundError'
}

export class TapayaConflictError extends TapayaApiError {
  override name = 'TapayaConflictError'
}

export class TapayaRateLimitError extends TapayaApiError {
  override name = 'TapayaRateLimitError'
  /** Delay requested by the `Retry-After` header, when present. */
  readonly retryAfterMs = parseRetryAfter(this.headers.get('retry-after'))
}

export class TapayaServerError extends TapayaApiError {
  override name = 'TapayaServerError'
}

/** A checkout session exists for the order, but its amount or currency differ. Do not fulfill or reuse it. */
export class TapayaOrderMismatchError extends TapayaError {
  override name = 'TapayaOrderMismatchError'

  constructor(readonly sessionId: string) {
    super('Checkout session does not match the order')
  }
}

export class Tapaya {
  readonly paymentMethods: PaymentMethods
  /** Saved-card payments: charge, authorize and capture, cancel, and refund. */
  readonly payments: Payments
  readonly checkout: {
    readonly sessions: CheckoutSessions
    configuration(options?: PaymentRequestOptions): Promise<PaymentConfiguration>
  }

  constructor(apiKey: string | undefined = readEnv('TAPAYA_SECRET_KEY'), options: TapayaOptions = {}) {
    if (!apiKey?.trim()) throw new TapayaError('Tapaya API key is required')
    validateTransportOptions(options, (message) => new TapayaError(message))
    const baseUrl = options.baseUrl ?? readEnv('TAPAYA_BASE_URL') ?? environmentBaseUrl(apiKey, options.environment)
    const client = new HttpClient({
      apiKey,
      merchantToken: options.merchantToken,
      baseUrl: validateUrl(baseUrl, 'Invalid Tapaya API base URL'),
      fetch: options.fetch ?? ((input, init) => fetch(input, init)),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    })
    const embeddedOptions: TapayaPaymentsOptions = {
      merchantToken: options.merchantToken,
      baseUrl,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      ...options.embedded,
    }
    const sessions = new CheckoutSessions(client, () => new TapayaPayments(apiKey, embeddedOptions))
    this.paymentMethods = new PaymentMethods(client)
    this.payments = new Payments(client)
    this.checkout = { sessions, configuration: (requestOptions) => sessions.configuration(requestOptions) }
  }
}

export type SavedPaymentMethod = {
  id: string
  type: 'card'
  customerReference: string
  usage: 'on_session' | 'off_session'
  card: {
    brand: string
    funding: string
    last4: string
    expMonth: number
    expYear: number
    cardholderName: string | null
    country: string | null
    /** The wallet that supplied the card, or null for a typed card. A device-bound method stops working when the shopper changes device. */
    wallet: { type: 'apple_pay' | 'google_pay' | (string & {}), deviceBound: boolean } | null
  }
  /** Terms the shopper accepted in the wallet sheet, or null. */
  walletAgreement?: WalletAgreement | null
  /** Evidence of the latest consent that granted `usage`, or null when none is recorded. */
  consent?: SavedPaymentMethodConsent | null
  fingerprint: string
  billingAddress: CheckoutContactAddress | null
  status: 'active' | 'expired' | (string & {})
  source: { type: 'checkout_session' | 'payment', id: string }
  createdAt: string
  updatedAt: string
}
export type SavedPaymentMethodConsent = {
  /** `checkbox` when the shopper selected the saving checkbox, `merchant_asserted` for `required` saving, where you collected consent. */
  type: 'checkbox' | 'merchant_asserted' | (string & {})
  acceptedAt: string
  /** Version of Tapaya's default saving wording. */
  wordingVersion: string
  savingTerms: SavingTerms | null
  /** Shopper browser at confirmation, or null for a server confirmation. */
  ipAddress: string | null
  userAgent: string | null
}
export type SavedPaymentMethodPage = { data: SavedPaymentMethod[], nextCursor: string | null }
export type UpdatePaymentMethod = {
  expMonth?: number | null
  expYear?: number | null
  cardholderName?: string | null
  billingAddress?: CheckoutContactAddress | null
}
const savedPaymentMethodSchema = z.object({
  id: z.string().min(1), type: z.literal('card'), customerReference: z.string().min(1),
  usage: z.enum(['on_session', 'off_session']),
  card: z.object({
    brand: z.string(), funding: z.string(), last4: z.string().regex(/^\d{4}$/),
    expMonth: z.number().int().min(1).max(12), expYear: z.number().int(),
    cardholderName: z.string().nullable(), country: z.string().nullable(),
    wallet: z.object({ type: z.string(), deviceBound: z.boolean() }).nullable(),
  }),
  walletAgreement: walletAgreementSchema.nullish(),
  consent: z.object({
    type: z.string(), acceptedAt: z.string(), wordingVersion: z.string(),
    savingTerms: z.object({ text: z.string().nullish(), url: z.string().nullish() }).nullable(),
    ipAddress: z.string().nullable(), userAgent: z.string().nullable(),
  }).nullish(),
  fingerprint: z.string(), billingAddress: contactAddressSchema.nullable(), status: z.string(),
  source: z.object({ type: z.enum(['checkout_session', 'payment']), id: z.string() }),
  createdAt: z.string(), updatedAt: z.string(),
}) satisfies z.ZodType<SavedPaymentMethod>
const savedPaymentMethodPageSchema = z.object({ data: z.array(savedPaymentMethodSchema), nextCursor: z.string().nullable() })
const updatePaymentMethodSchema = z.object({
  expMonth: z.number().int().min(1).max(12).nullish(), expYear: z.number().int().min(2000).max(9999).nullish(),
  cardholderName: z.string().max(200).nullish(), billingAddress: contactAddressSchema.strict().nullish(),
}).strict()

/** Server-only saved card lifecycle, authenticated with the same merchant as Checkout. */
export class PaymentMethods {
  constructor(private readonly client: HttpClient) {}

  /** `wallet` lists only typed cards (`none`) or one wallet's methods. */
  async list(params: { customerReference: string, limit?: number, cursor?: string, wallet?: 'none' | 'apple_pay' | 'google_pay' }, options: RequestOptions = {}): Promise<SavedPaymentMethodPage> {
    const input = z.object({ customerReference: cardSavingFields.customerReference.unwrap().unwrap(),
      limit: z.number().int().min(1).max(100).optional(), cursor: z.string().min(1).optional(),
      wallet: z.enum(['none', 'apple_pay', 'google_pay']).optional(),
    }).safeParse(params)
    if (!input.success) throw new TapayaValidationError('Invalid saved card list parameters', fieldErrors(input.error))
    const query = new URLSearchParams({ customerReference: input.data.customerReference })
    if (input.data.limit !== undefined) query.set('limit', String(input.data.limit))
    if (input.data.cursor !== undefined) query.set('cursor', input.data.cursor)
    if (input.data.wallet !== undefined) query.set('wallet', input.data.wallet)
    const response = await this.client.request('GET', `/merchant/saved-payment-methods?${query}`, options)
    return this.parse(response, savedPaymentMethodPageSchema)
  }

  async get(id: string, options: RequestOptions = {}): Promise<SavedPaymentMethod> {
    return this.parse(await this.client.request('GET', this.path(id), options), savedPaymentMethodSchema)
  }

  async update(id: string, params: UpdatePaymentMethod, options: RequestOptions = {}): Promise<SavedPaymentMethod> {
    const input = updatePaymentMethodSchema.safeParse(params)
    if (!input.success) throw new TapayaValidationError('Invalid saved card update', fieldErrors(input.error))
    return this.parse(await this.client.request('PATCH', this.path(id), options, {
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(input.data),
    }), savedPaymentMethodSchema)
  }

  async delete(id: string, options: RequestOptions = {}): Promise<{ id: string, deleted: true }> {
    return this.parse(await this.client.request('DELETE', this.path(id), options), z.object({ id: z.literal(id), deleted: z.literal(true) }))
  }

  private path(id: string): string {
    if (typeof id !== 'string' || !id.trim() || id.length > 200 || id === '.' || id === '..')
      throw new TapayaValidationError('Invalid saved card ID')
    return `/merchant/saved-payment-methods/${encodeURIComponent(id)}`
  }
  private parse<T>(response: HttpResponse, schema: z.ZodType<T>): T {
    const result = schema.safeParse(response.body)
    if (!result.success) throw new TapayaResponseError('Tapaya returned an invalid saved card response', response.status, response.headers)
    return result.data
  }
}

/** Normalized reason of a declined charge or operation. New values may be added. */
export type DeclineReason =
  | 'insufficient_funds' | 'card_expired' | 'authentication_required' | 'limit_exceeded' | 'fraud_suspected'
  | 'do_not_retry' | 'card_declined' | 'processing_error' | (string & {})

/**
 * Status of a payment. `action_required`: the shopper must verify the saved card (see `nextAction`). `authorized`: a
 * manual-capture authorization waiting for `capture` or `cancel`. `pending`: the outcome is not known yet; read the
 * payment again. HTTP 200 alone never means the payment succeeded.
 */
export type PaymentStatus =
  | 'ready' | 'pending' | 'action_required' | 'authorized' | 'successful' | 'declined' | 'cancelled'

type SavedCardPaymentFields = {
  /** Stable order reference, at most 200 characters. At most one payment per order succeeds. */
  merchantOrderId: string
  /** Integer minor units, between 1 and 2,147,483,647. */
  amount: number
  /** Uppercase three-letter ISO currency code. */
  currency: string
  /** Saved card to charge, from `paymentMethods.list`. */
  paymentMethodId: string
  /** `manual` authorizes only; capture or cancel it later. Defaults to `automatic`. */
  captureMethod?: 'automatic' | 'manual'
  /** Authorize an estimate that `increment` can raise. Requires `captureMethod: 'manual'`. */
  allowIncrementalAuthorization?: boolean
  /** Optional customer risk and billing details. */
  customer?: CheckoutCustomer | null
}

/**
 * The shopper is on your site, for example a one-click purchase. The payment returns `action_required`; finish it in
 * the browser with Tapaya.js `handleNextAction({ clientSecret })`, or redirect the shopper to `nextAction.url`.
 */
export type CreateCustomerInitiatedPaymentParams = SavedCardPaymentFields & {
  initiator: 'customer'
  /**
   * Where the hosted fallback page at `nextAction.url` returns the shopper, as `returnUrl?paymentId=…`. Must match an
   * allowed checkout website. Required even when you use `handleNextAction`, which does not navigate.
   */
  returnUrl: string
  merchantInitiatedReason?: never
}

/** The shopper is absent, for example a subscription renewal or a top-up. Tapaya charges the card at once. */
export type CreateMerchantInitiatedPaymentParams = SavedCardPaymentFields & {
  initiator: 'merchant'
  /** `recurring` for a fixed series, `unscheduled` for top-ups and other variable charges. */
  merchantInitiatedReason: 'recurring' | 'unscheduled'
  returnUrl?: never
}

export type CreateSavedCardPaymentParams = CreateCustomerInitiatedPaymentParams | CreateMerchantInitiatedPaymentParams

/** How the shopper completes an `action_required` payment. */
export type PaymentNextAction = {
  /** Always `three_d_secure`: the shopper verifies the saved card with their bank. */
  type: 'three_d_secure'
  /** Hosted fallback page for the same action, for emails or pages without Tapaya.js. Redirect with HTTP 303. */
  url: string
  /** After this time the payment is cancelled without a charge. */
  expiresAt: string
}

/** A payment as your server reads it. Fulfill only after reading `successful` (or `authorized` for holds) here. */
export type Payment = {
  customer?: CheckoutCustomer | null
  shippingQuote?: ShippingQuote | null
  id: string
  merchantOrderId: string
  status: PaymentStatus
  amount: number
  currency: string
  /** Whether the order accepts a new payment after this one's decline or cancellation. */
  retryAllowed: boolean
  /** Pass to Tapaya.js `handleNextAction` while `action_required`. Null for merchant-initiated payments and after expiry or revocation. Never log or persist it. */
  clientSecret: string | null
  paymentMethodId: string | null
  initiator: 'customer' | 'merchant' | null
  merchantInitiatedReason: 'recurring' | 'unscheduled' | null
  captureMethod: 'automatic' | 'manual'
  amountAuthorized: number
  amountCaptured: number
  amountRefunded: number
  /** Capture an `authorized` payment before this time; Tapaya voids it afterwards. */
  authorizationExpiresAt: string | null
  /** Set while `action_required`. */
  nextAction: PaymentNextAction | null
  /** Set after a declined charge, or a declined increment of an authorization. */
  declineReason: DeclineReason | null
  createdAt: string
}

export type PaymentRefund = {
  id: string
  paymentId: string
  amount: number
  currency: string
  status: 'pending' | 'succeeded' | 'failed' | (string & {})
  reason: 'requested_by_customer' | 'duplicate' | 'fraudulent' | 'other' | (string & {})
  createdAt: string
}

export type CreateRefundParams = {
  /** Integer minor units. Omit to refund the rest of the captured amount. */
  amount?: number
  /** Defaults to `requested_by_customer`. */
  reason?: 'requested_by_customer' | 'duplicate' | 'fraudulent' | 'other'
}

/** Every write needs an idempotency key. Store yours with the order to retry safely across processes. */
export type PaymentWriteOptions = RequestOptions & {
  /** Sent as `Idempotency-Key`, 1 to 255 printable ASCII characters without spaces. Defaults to a random UUID per call. */
  idempotencyKey?: string
}

const nullishText = z.string().nullable()
const savedCardPaymentSchema = z.object({
  customer: customerSchema.nullish(),
  shippingQuote: shippingQuoteSchema.nullish(),
  id: z.string().min(1),
  merchantOrderId: z.string(),
  status: z.enum(['ready', 'pending', 'action_required', 'authorized', 'successful', 'declined', 'cancelled']),
  amount: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  retryAllowed: z.boolean(),
  clientSecret: nullishText,
  paymentMethodId: nullishText.default(null),
  initiator: z.enum(['customer', 'merchant']).nullable().default(null),
  merchantInitiatedReason: z.enum(['recurring', 'unscheduled']).nullable().default(null),
  captureMethod: z.enum(['automatic', 'manual']).default('automatic'),
  amountAuthorized: z.number().int().nonnegative().default(0),
  amountCaptured: z.number().int().nonnegative().default(0),
  amountRefunded: z.number().int().nonnegative().default(0),
  authorizationExpiresAt: nullishText.default(null),
  nextAction: z.object({ type: z.literal('three_d_secure'), url: z.string(), expiresAt: z.string() }).nullable().default(null),
  declineReason: nullishText.default(null),
  createdAt: z.string(),
}) satisfies z.ZodType<Payment, unknown>
const refundSchema = z.object({
  id: z.string().min(1), paymentId: z.string().min(1), amount: z.number().int().positive(), currency: z.string(),
  status: z.string(), reason: z.string(), createdAt: z.string(),
}) satisfies z.ZodType<PaymentRefund>
const positiveAmount = z.number().int().positive().max(MAX_INT32)
const createSavedCardPaymentSchema = z.object({
  merchantOrderId: z.string().max(200).refine((value) => value.trim().length > 0),
  amount: positiveAmount,
  currency: z.string().regex(/^[A-Z]{3}$/),
  paymentMethodId: z.string().min(1).max(128),
  initiator: z.enum(['customer', 'merchant']),
  merchantInitiatedReason: z.enum(['recurring', 'unscheduled']).optional(),
  captureMethod: z.enum(['automatic', 'manual']).optional(),
  allowIncrementalAuthorization: z.boolean().optional(),
  returnUrl: z.string().min(1).max(2048).optional(),
  customer: customerInputSchema.nullish(),
}).strict().superRefine((value, context) => {
  if (value.initiator === 'customer' && !value.returnUrl)
    context.addIssue({ code: 'custom', path: ['returnUrl'], message: 'A return URL is required when the shopper is present' })
  if (value.initiator === 'customer' && value.merchantInitiatedReason)
    context.addIssue({ code: 'custom', path: ['merchantInitiatedReason'], message: 'Only merchant-initiated payments have a reason' })
  if (value.initiator === 'merchant' && !value.merchantInitiatedReason)
    context.addIssue({ code: 'custom', path: ['merchantInitiatedReason'], message: 'Use recurring or unscheduled' })
  if (value.initiator === 'merchant' && value.returnUrl)
    context.addIssue({ code: 'custom', path: ['returnUrl'], message: 'Only customer-initiated payments return the shopper' })
  if (value.allowIncrementalAuthorization && value.captureMethod !== 'manual')
    context.addIssue({ code: 'custom', path: ['allowIncrementalAuthorization'], message: 'Requires captureMethod manual' })
})

/**
 * Server-only payments on saved cards, with authorization, capture and refunds. Authenticated with the same merchant
 * as Checkout. Writes retry safely under their idempotency key.
 */
export class Payments {
  readonly refunds: {
    create(paymentId: string, params?: CreateRefundParams, options?: PaymentWriteOptions): Promise<PaymentRefund>
    list(paymentId: string, options?: RequestOptions): Promise<PaymentRefund[]>
    get(paymentId: string, refundId: string, options?: RequestOptions): Promise<PaymentRefund>
  }

  constructor(private readonly client: HttpClient) {
    this.refunds = {
      create: async (paymentId, params = {}, options = {}) => {
        const input = z.object({ amount: positiveAmount.optional(), reason: z.enum(['requested_by_customer', 'duplicate', 'fraudulent', 'other']).optional() })
          .strict().safeParse(params)
        if (!input.success) throw new TapayaValidationError('Invalid refund parameters', fieldErrors(input.error))
        return this.parse(await this.write(`${this.path(paymentId)}/refunds`, input.data, options), refundSchema, 'refund')
      },
      list: async (paymentId, options = {}) =>
        this.parse(await this.client.request('GET', `${this.path(paymentId)}/refunds`, options), z.object({ data: z.array(refundSchema) }), 'refund list').data,
      get: async (paymentId, refundId, options = {}) =>
        this.parse(await this.client.request('GET', `${this.path(paymentId)}/refunds/${this.segment(refundId, 'refundId')}`, options), refundSchema, 'refund'),
    }
  }

  /**
   * Prepare a new card payment or charge a saved card. A merchant-initiated payment is charged before this resolves. A customer-initiated one is
   * `action_required`: pass its `clientSecret` to Tapaya.js `handleNextAction`, then read the payment again here.
   */
  async create(params: CreateSavedCardPaymentParams | CreatePayment, options: PaymentWriteOptions = {}): Promise<Payment> {
    const input = params && 'paymentMethodId' in params
      ? createSavedCardPaymentSchema.safeParse(params)
      : createPaymentSchema.strict().safeParse(params)
    if (!input.success) throw new TapayaValidationError('Invalid payment parameters', fieldErrors(input.error))
    if ('returnUrl' in input.data && input.data.returnUrl !== undefined)
      validateUrl(input.data.returnUrl, 'Invalid returnUrl', (message) => new TapayaValidationError(message, [{ field: 'returnUrl', message }]))
    const payment = this.parsePayment(await this.write('/merchant/payments', input.data, options))
    const quote = payment.shippingQuote
    const selected = 'shippingOptions' in input.data && input.data.shippingOptions && quote && ['approved', 'accepted'].includes(quote.status)
      ? quote.options.find(option => option.id === quote.selectedOptionId) : undefined
    if (payment.merchantOrderId !== input.data.merchantOrderId || payment.amount !== (selected?.amount ?? input.data.amount) || payment.currency !== input.data.currency)
      throw new TapayaResponseError('Payment does not match the order', 200)
    return payment
  }

  async get(id: string, options: RequestOptions = {}): Promise<Payment> {
    return this.forId(id, await this.client.request('GET', this.path(id), options))
  }

  /** Capture an `authorized` payment once. Omit the amount to capture everything authorized; a partial capture releases the rest. */
  async capture(id: string, params: { amount?: number } = {}, options: PaymentWriteOptions = {}): Promise<Payment> {
    const input = z.object({ amount: positiveAmount.optional() }).strict().safeParse(params)
    if (!input.success) throw new TapayaValidationError('Invalid capture parameters', fieldErrors(input.error))
    return this.forId(id, await this.write(`${this.path(id)}/capture`, input.data, options))
  }

  /** Raise an incremental authorization by `amount`. A declined increment keeps the original authorization and sets `declineReason`. */
  async increment(id: string, params: { amount: number }, options: PaymentWriteOptions = {}): Promise<Payment> {
    const input = z.object({ amount: positiveAmount }).strict().safeParse(params)
    if (!input.success) throw new TapayaValidationError('Invalid increment parameters', fieldErrors(input.error))
    return this.forId(id, await this.write(`${this.path(id)}/increment`, input.data, options))
  }

  /** Void an `authorized` payment, or cancel an `action_required` one. Refund a captured payment instead. */
  async cancel(id: string, options: PaymentWriteOptions = {}): Promise<Payment> {
    return this.forId(id, await this.write(`${this.path(id)}/cancel`, undefined, options))
  }

  private write(path: string, body: unknown, options: PaymentWriteOptions): Promise<HttpResponse> {
    const { idempotencyKey = globalThis.crypto.randomUUID(), ...request } = options
    if (typeof idempotencyKey !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(idempotencyKey))
      throw new TapayaValidationError('Invalid idempotency key', [{ field: 'idempotencyKey', message: 'Use 1 to 255 printable ASCII characters without spaces' }])
    // The key and body are fixed before the first attempt, so automatic retries replay the same request.
    return this.client.request('POST', path, request, {
      headers: { 'idempotency-key': idempotencyKey, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  private forId(id: string, response: HttpResponse): Payment {
    const payment = this.parsePayment(response)
    if (normalizePaymentId(payment.id) !== normalizePaymentId(id))
      throw new TapayaResponseError('Payment identity does not match', response.status, response.headers)
    return payment
  }

  private parsePayment(response: HttpResponse): Payment {
    const payment = this.parse(response, savedCardPaymentSchema, 'payment')
    if (payment.clientSecret !== null && payment.clientSecret.slice(0, 32) !== normalizePaymentId(payment.id))
      throw new TapayaResponseError('Client secret does not match the payment', response.status, response.headers)
    return payment
  }

  private path(id: string): string {
    return `/merchant/payments/${this.segment(id, 'id')}`
  }

  private segment(value: string, field: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 200 || value === '.' || value === '..')
      throw new TapayaValidationError(`Invalid ${field}`, [{ field, message: `Invalid ${field}` }])
    return encodeURIComponent(value)
  }

  private parse<T>(response: HttpResponse, schema: z.ZodType<T, unknown>, what: string): T {
    const result = schema.safeParse(response.body)
    if (!result.success) throw new TapayaResponseError(`Tapaya returned an invalid ${what} response`, response.status, response.headers)
    return result.data
  }
}

function fieldErrors(error: z.ZodError): TapayaFieldError[] {
  return error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message, code: issue.code }))
}

class CheckoutSessions {
  readonly #client: HttpClient
  readonly #createPayments: () => TapayaPayments
  #payments: TapayaPayments | undefined

  constructor(client: HttpClient, createPayments: () => TapayaPayments) {
    this.#client = client
    this.#createPayments = createPayments
  }

  #embedded(): TapayaPayments {
    return this.#payments ??= this.#createPayments()
  }

  create(params: CreateHostedCheckoutSessionParams, options?: CreateSessionOptions): Promise<HostedCheckoutSession>
  create(params: CreateEmbeddedCheckoutSessionParams, options?: CreateEmbeddedSessionOptions): Promise<EmbeddedCheckoutSession>
  create(params: CreateCheckoutSessionParams, options?: CreateEmbeddedSessionOptions): Promise<CheckoutSession>
  async create(params: CreateCheckoutSessionParams, options: CreateSessionOptions = {}): Promise<CheckoutSession> {
    validateCheckoutMode(params?.mode)
    if (params?.mode === 'embedded') {
      validateEmbeddedRequestOptions(options)
      const { mode: _mode, ...payment } = params
      const input = createPaymentSchema.strict().safeParse(payment)
      if (!input.success) {
        throw new TapayaValidationError('Invalid embedded checkout session parameters', input.error.issues.map((issue) => ({
          field: issue.path.join('.'), message: issue.message, code: issue.code,
        })))
      }
      return embeddedSession(await this.#embedded().prepare(input.data, options.idempotencyKey ?? globalThis.crypto.randomUUID(), options))
    }
    const input = createSessionSchema.safeParse(params)
    if (!input.success) {
      throw new TapayaValidationError('Invalid checkout session parameters', input.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })))
    }
    for (const field of ['successUrl', 'cancelUrl'] as const) {
      const url = input.data[field]
      if (url != null) validateUrl(url, `Invalid ${field}`, (message) => new TapayaValidationError(message, [{ field, message }]))
    }
    const idempotencyKey = options.idempotencyKey ?? globalThis.crypto.randomUUID()
    if (!idempotencyKey.trim() || idempotencyKey.length > 250 || /[^\x20-\x7e]/.test(idempotencyKey)) {
      throw new TapayaValidationError('Idempotency key must be between 1 and 250 characters and safe for an HTTP header')
    }
    // Choose the key and serialize once so retries replay the exact request.
    const response = await this.#client.request('POST', '/merchant/checkout-sessions', options, {
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input.data),
    })
    return parseSession(response)
  }

  /** @deprecated Use `get`. */
  retrieve(id: string, options?: RetrieveHostedSessionOptions): Promise<HostedCheckoutSession>
  retrieve(id: string, options: RetrieveEmbeddedSessionOptions): Promise<EmbeddedCheckoutSession>
  retrieve(id: string, options: RetrieveSessionOptions): Promise<CheckoutSession>
  retrieve(id: string, options: RetrieveSessionOptions = {}): Promise<CheckoutSession> {
    return this.get(id, options)
  }

  /** Read a session. Omitted mode selects hosted checkout. */
  get(id: string, options?: RetrieveHostedSessionOptions): Promise<HostedCheckoutSession>
  get(id: string, options: RetrieveEmbeddedSessionOptions): Promise<EmbeddedCheckoutSession>
  get(id: string, options: RetrieveSessionOptions): Promise<CheckoutSession>
  async get(id: string, options: RetrieveSessionOptions = {}): Promise<CheckoutSession> {
    validateCheckoutMode(options.mode)
    if (options.mode === 'embedded') {
      validateEmbeddedRequestOptions(options)
      return embeddedSession(await this.#embedded().retrieve(id, options))
    }
    if (!id.trim() || id.length > 200 || id === '.' || id === '..') {
      throw new TapayaValidationError('Invalid checkout session ID', [{ field: 'id', message: 'Invalid checkout session ID' }])
    }
    const response = await this.#client.request('GET', `/merchant/checkout-sessions/${encodeURIComponent(id)}`, options)
    return parseSession(response)
  }

  /** Browser initialization settings for embedded checkout. */
  async configuration(options: PaymentRequestOptions = {}): Promise<PaymentConfiguration> {
    validateEmbeddedRequestOptions(options)
    return this.#embedded().configuration(options)
  }

  /**
   * Return the order's embedded session for the browser. Reuses an unresolved or ended session, and
   * creates the first attempt, or the next one after a decline or cancellation that allows a retry. Safe to
   * call on every page load and every submission: lost responses replay the same attempt.
   */
  async prepare(order: CreatePayment, options: PaymentRequestOptions = {}): Promise<EmbeddedCheckoutSession> {
    const existing = await this.findByOrder(order?.merchantOrderId, options)
    const shipping = order.shippingOptions != null || existing?.shippingQuote != null
    if (existing && !shipping && (existing.amount !== order.amount || existing.currency !== order.currency)) throw new TapayaOrderMismatchError(existing.id)
    // A quote may change the read total. Replay creation so the backend verifies the immutable input hash instead.
    if (existing && !shipping && !((existing.paymentStatus === 'failed' || existing.paymentStatus === 'cancelled') && existing.retryAllowed)) return existing
    const retry = existing && (existing.paymentStatus === 'failed' || existing.paymentStatus === 'cancelled') && existing.retryAllowed
    let key = `${order.merchantOrderId}:${existing ? `${retry ? 'after' : 'validate'}:${existing.id}` : 'initial'}`
    // Preserve existing keys for replay, and hash references that cannot be HTTP header values.
    if (/[^\x21-\x7e]/.test(key)) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
      key = `prepare:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
    }
    return this.create(
      { ...order, mode: 'embedded' },
      { ...options, idempotencyKey: key },
    )
  }

  /**
   * Read the order's current embedded session, or `null` before one exists. Throws
   * `TapayaOrderMismatchError` when its order ID, amount, or currency differ from `order`.
   * Fulfill paid orders only when `paymentStatus` is `successful`. `authorized` is an uncaptured hold.
   */
  async verify(order: Pick<CreatePayment, 'merchantOrderId' | 'amount' | 'currency'>, options: PaymentRequestOptions = {}): Promise<EmbeddedCheckoutSession | null> {
    const session = await this.findByOrder(order?.merchantOrderId, options)
    if (session && (session.amount !== order.amount || session.currency !== order.currency)) {
      throw new TapayaOrderMismatchError(session.id)
    }
    return session
  }

  /** Find an embedded checkout attempt after losing its creation response. */
  async findByOrder(order: string, options: PaymentRequestOptions = {}): Promise<EmbeddedCheckoutSession | null> {
    validateEmbeddedRequestOptions(options)
    const payment = await this.#embedded().findByOrder(order, options)
    return payment === null ? null : embeddedSession(payment)
  }

  /** Confirm an embedded checkout once using a token from the browser card fields. */
  async confirm(id: string, token: string, options: PaymentConfirmationOptions = {}): Promise<EmbeddedCheckoutSession> {
    validateEmbeddedRequestOptions(options)
    return embeddedSession(await this.#embedded().confirm(id, token, options))
  }

  async recover(id: string, options: PaymentRequestOptions = {}): Promise<EmbeddedCheckoutSession> {
    validateEmbeddedRequestOptions(options)
    return embeddedSession(await this.#embedded().recover(id, options))
  }

  /** Approve an embedded payment's pending shipping revision from your server. */
  async approveShippingQuote(id: string, approval: ShippingQuoteApproval, options: PaymentRequestOptions = {}): Promise<ShippingQuote> {
    validateEmbeddedRequestOptions(options)
    return this.#embedded().approveShippingQuote(id, approval, options)
  }

  async revokeClientSecret(id: string, options: PaymentRequestOptions = {}): Promise<void> {
    validateEmbeddedRequestOptions(options)
    return this.#embedded().revokeClientSecret(id, options)
  }
}

function validateCheckoutMode(mode: unknown): void {
  if (mode !== undefined && mode !== 'hosted' && mode !== 'embedded') {
    throw new TapayaValidationError('Invalid checkout mode', [{ field: 'mode', message: 'Use hosted or embedded' }])
  }
}

function validateEmbeddedRequestOptions(options: PaymentRequestOptions & { maxRetries?: number }): void {
  if (options.maxRetries !== undefined && options.maxRetries !== 0) {
    throw new TapayaValidationError('Embedded checkout never retries automatically', [{ field: 'maxRetries', message: 'Automatic retries are not supported' }])
  }
}

function embeddedSession(payment: MerchantPayment): EmbeddedCheckoutSession {
  const { status: paymentStatus, ...fields } = payment
  return {
    ...fields,
    mode: 'embedded',
    url: null,
    status: paymentStatus === 'successful' || paymentStatus === 'authorized'
      ? 'completed'
      : (paymentStatus === 'cancelled' || paymentStatus === 'declined') && !fields.retryAllowed ? 'ended' : 'open',
    paymentStatus: paymentStatus === 'ready' ? 'unpaid' : paymentStatus === 'declined' ? 'failed' : paymentStatus === 'action_required' ? 'action_needed' : paymentStatus,
  }
}

export type { CheckoutSessions }

function parseSession({ body, status, headers }: HttpResponse): HostedCheckoutSession {
  const result = sessionSchema.safeParse(body)
  if (!result.success) throw new TapayaResponseError('Tapaya returned an invalid checkout session', status, headers)
  validateUrl(
    result.data.url,
    'Tapaya returned an unexpected checkout URL',
    (message) => new TapayaResponseError(message, status, headers),
  )
  return { ...result.data, mode: 'hosted' }
}

type HttpResponse = { status: number, headers: Headers, body: unknown }

type HttpClientConfig = {
  apiKey: string
  merchantToken?: string
  baseUrl: URL
  fetch: typeof fetch
  timeoutMs: number
  maxRetries: number
}

class HttpClient {
  readonly #config: HttpClientConfig

  constructor(config: HttpClientConfig) {
    this.#config = config
  }

  async request(
    method: string,
    path: string,
    options: RequestOptions,
    init: { headers?: Record<string, string>, body?: string } = {},
  ): Promise<HttpResponse> {
    validateTransportOptions(
      options,
      (message, field) => new TapayaValidationError(message, [{ field, message }]),
    )
    const { signal } = options
    const timeoutMs = options.timeoutMs ?? this.#config.timeoutMs
    const maxRetries = options.maxRetries ?? this.#config.maxRetries
    const url = new URL(path, this.#config.baseUrl).href
    const headers = {
      accept: 'application/json',
      authorization: `Bearer ${this.#config.apiKey}`,
      ...((options.merchantToken ?? this.#config.merchantToken) === undefined ? {} : {
        'X-Tapaya-Merchant-Token': options.merchantToken ?? this.#config.merchantToken,
      }),
      'user-agent': USER_AGENT,
      ...init.headers,
    }
    for (let attempt = 0; ; attempt += 1) {
      signal?.throwIfAborted()
      const timeout = AbortSignal.timeout(timeoutMs)
      let response: Response
      let text: string
      try {
        response = await this.#config.fetch(url, {
          method,
          headers,
          body: init.body,
          redirect: 'error',
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        })
        text = await response.text()
      } catch (cause) {
        if (signal?.aborted) throw signal.reason
        const error = timeout.aborted
          ? new TapayaTimeoutError(`Tapaya request timed out after ${timeoutMs} ms`, { cause })
          : new TapayaConnectionError('Could not connect to Tapaya', { cause })
        if (attempt >= maxRetries) throw error
        await sleep(backoffDelay(attempt), signal)
        continue
      }
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        if (response.ok) throw new TapayaResponseError('Tapaya returned invalid JSON', response.status, response.headers)
      }
      if (response.ok) return { status: response.status, headers: response.headers, body }
      const error = createApiError(response, body)
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
      if (
        (RETRYABLE_STATUSES.has(response.status) || (error.status === 409 && error.code === IDEMPOTENCY_IN_PROGRESS)) &&
        attempt < maxRetries && (retryAfterMs === undefined || retryAfterMs <= MAX_RETRY_AFTER_MS)
      ) {
        await sleep(retryAfterMs ?? backoffDelay(attempt), signal)
        continue
      }
      throw error
    }
  }
}

function validateTransportOptions(
  options: { timeoutMs?: number, maxRetries?: number, merchantToken?: string },
  createError: (message: string, field: 'timeoutMs' | 'maxRetries' | 'merchantToken') => TapayaError,
): void {
  if (options.merchantToken !== undefined && (typeof options.merchantToken !== 'string' ||
    !options.merchantToken.trim() || options.merchantToken.length > 128 || /[\r\n]/.test(options.merchantToken))) {
    throw createError('Invalid merchantToken', 'merchantToken')
  }
  for (const name of ['timeoutMs', 'maxRetries'] as const) {
    const value = options[name]
    // Timers fire after 1 ms for delays beyond MAX_INT32.
    const max = name === 'timeoutMs' ? MAX_INT32 : Number.MAX_SAFE_INTEGER
    if (value !== undefined && (!Number.isInteger(value) || value < (name === 'timeoutMs' ? 1 : 0) || value > max)) {
      throw createError(`Invalid ${name}`, name)
    }
  }
}

function createApiError({ status, headers }: Response, body: unknown): TapayaApiError {
  const payload = body !== null && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  const message = typeof payload.message === 'string' && payload.message.trim()
    ? payload.message
    : `${defaultErrorMessage(status)} (${status})`
  const code = typeof payload.errorCode === 'string' ? payload.errorCode : undefined
  const fieldErrors = Array.isArray(payload.errors)
    ? payload.errors.flatMap((entry): TapayaFieldError[] => {
      if (entry === null || typeof entry !== 'object') return []
      const { field, message, code } = entry as Record<string, unknown>
      if (typeof field !== 'string' || typeof message !== 'string') return []
      return [typeof code === 'string' ? { field, message, code } : { field, message }]
    })
    : []
  const ErrorClass = status === 400 || status === 422 ? TapayaInvalidRequestError
    : status === 401 ? TapayaAuthenticationError
    : status === 403 ? TapayaPermissionError
    : status === 404 ? TapayaNotFoundError
    : status === 409 ? TapayaConflictError
    : status === 429 ? TapayaRateLimitError
    : status >= 500 ? TapayaServerError
    : TapayaApiError
  return new ErrorClass(message, { status, headers, code, fieldErrors })
}

/** Used when the response has no message, such as authentication and rate limit responses, which have no body. */
function defaultErrorMessage(status: number): string {
  if (status === 400 || status === 422) return 'Tapaya rejected the request parameters'
  if (status === 401) return 'Tapaya rejected the API key. Check that it is valid, active, and matches the environment'
  if (status === 403) return 'The API key is not allowed to make this request'
  if (status === 404) return 'Tapaya could not find the requested resource'
  if (status === 409) return 'The request conflicts with an earlier request'
  if (status === 429) return 'Too many requests to Tapaya. Try again later'
  if (status >= 500) return 'Tapaya could not process the request'
  return 'Tapaya request failed'
}

/** Exponential backoff with jitter: about 0.5 s, 1 s, 2 s, ... capped at 8 s. */
function backoffDelay(attempt: number): number {
  const delay = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS)
  return delay * (0.5 + Math.random() * 0.5)
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !value.trim()) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Reads an environment variable without requiring Node.js globals. */
function readEnv(name: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name]
}

/** Live merchant keys work only in production and test keys never do, so the key decides when nothing else is set. */
function environmentBaseUrl(apiKey: string, environment?: TapayaEnvironment): string {
  const name = environment ?? readEnv('TAPAYA_ENVIRONMENT')
  const live = apiKey.startsWith('tapaya_live_') ? true : apiKey.startsWith('tapaya_test_') ? false : undefined
  if (name === undefined) return API_BASE_URLS[live ? 'production' : 'sandbox']
  if (name !== 'sandbox' && name !== 'production') {
    throw new TapayaError('Invalid Tapaya environment: expected sandbox or production')
  }
  if (live !== undefined && live !== (name === 'production')) {
    throw new TapayaError(`A ${live ? 'live' : 'test'} Tapaya API key cannot be used in ${name}`)
  }
  return API_BASE_URLS[name]
}

function validateUrl(
  value: string,
  message: string,
  createError: (message: string) => TapayaError = (message) => new TapayaError(message),
): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw createError(message)
  }
  const localHttp = url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    readEnv('NODE_ENV') !== 'production'
  if (
    (url.protocol !== 'https:' && !localHttp) ||
    url.username || url.password
  ) {
    throw createError(message)
  }
  return url
}

export type PaymentAddress = CheckoutContactAddress

export type CreatePayment = CardSavingOptions & {
  /** Manual authorizes a new card without capturing funds. Not supported with shippingOptions. */
  captureMethod?: 'automatic' | 'manual'
  allowIncrementalAuthorization?: boolean
  /** Required for manual capture. Must match an allowed checkout website. */
  returnUrl?: string
  /** Stable order reference, at most 200 characters. */
  merchantOrderId: string
  /** Integer minor units. Zero verifies and saves a new card with required saving. */
  amount: number
  /** Uppercase three-letter ISO currency code. */
  currency: string
  /** Optional customer risk and billing details. Omit fields you do not collect. */
  customer?: CheckoutCustomer | null
  /** Null or omission uses merchant defaults; an empty object disables collection. */
  customerCollection?: CustomerCollection | null
  shippingOptions?: ShippingOptions | null
}

export type MerchantPayment = {
  /** Accepted customer snapshot, or merchant input before submission. Absent on older responses. */
  customer?: CheckoutCustomer | null
  shippingQuote?: ShippingQuote | null
  paymentMethodId?: string | null
  id: string
  merchantOrderId: string
  amount: number
  currency: string
  /** Authoritative status of an embedded payment attempt. */
  status: PaymentStatus
  retryAllowed: boolean
  /** Pass to the browser only. Null after expiry or revocation; server status reads still work. Never log or persist it. */
  clientSecret: string | null
}

export type PaymentConfiguration = {
  /** Safe to expose in the browser. */
  publishableKey: string
  environment: 'sandbox' | 'production'
  /** Origin of the Tapaya API this server talks to. Pass it to the browser loader as `apiOrigin`. */
  apiOrigin: string
}

/** Embedded requests never retry automatically, including charge submissions. */
export type PaymentRequestOptions = Pick<RequestOptions, 'signal' | 'timeoutMs' | 'merchantToken'>
export type PaymentConfirmationOptions = PaymentRequestOptions & {
  /** Optional saving only, after the shopper selects the supplied consent wording. */
  saveCard?: boolean
  customer?: CheckoutCustomer | null
  shippingQuote?: ShippingConfirmation | null
}
export type TapayaPaymentsOptions = Pick<PaymentRequestOptions, 'timeoutMs' | 'merchantToken'> & {
  baseUrl?: string
  fetch?: typeof fetch
}

const createPaymentSchema = z.object({
  ...cardSavingFields,
  captureMethod: z.enum(['automatic', 'manual']).optional(),
  allowIncrementalAuthorization: z.boolean().optional(),
  returnUrl: z.string().url().max(2048).optional(),
  merchantOrderId: z.string().max(200).refine((value) => value.trim().length > 0),
  amount: z.number().int().nonnegative().max(MAX_INT32),
  currency: z.string().regex(/^[A-Z]{3}$/),
  customer: customerInputSchema.nullish(),
  customerCollection: customerCollectionSchema.nullish(),
  shippingOptions: shippingOptionsSchema.nullish(),
}).superRefine((value, context) => {
  validateCardSaving(value, context)
  if (value.captureMethod === 'manual') {
    if (!value.returnUrl)
      context.addIssue({ code: 'custom', path: ['returnUrl'], message: 'New-card manual capture requires returnUrl' })
    if (value.shippingOptions != null)
      context.addIssue({ code: 'custom', path: ['shippingOptions'], message: 'Manual capture does not support shippingOptions' })
  } else if (value.allowIncrementalAuthorization || value.returnUrl !== undefined) {
    context.addIssue({ code: 'custom', path: ['captureMethod'], message: 'Incremental authorization and returnUrl require manual capture' })
  }
  if (value.amount === 0 && (value.savePaymentMethod !== 'required' || value.shippingOptions != null))
    context.addIssue({ code: 'custom', path: ['amount'], message: 'Zero-amount verification requires required saving without shipping' })
}) satisfies z.ZodType<CreatePayment>

const merchantPaymentSchema = z.object({
  customer: customerSchema.nullish(),
  shippingQuote: shippingQuoteSchema.nullish(),
  paymentMethodId: z.string().nullable().optional(),
  id: z.string().min(1),
  merchantOrderId: z.string(),
  amount: z.number().int().nonnegative().max(MAX_INT32),
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: z.enum(['ready', 'successful', 'authorized', 'declined', 'pending', 'action_required', 'cancelled']),
  retryAllowed: z.boolean(),
  clientSecret: z.string().regex(/^[0-9a-f]{32}_secret_[A-Za-z0-9-]{1,32}_[A-Za-z0-9_-]{43}$/).nullable(),
}) satisfies z.ZodType<MerchantPayment>

export class PaymentsApiError extends TapayaApiError {
  override name = 'PaymentsApiError'

  constructor(
    status: number,
    message: string,
    details: { headers?: Headers, code?: string, fieldErrors?: TapayaFieldError[] } = {},
  ) {
    super(message, { ...details, status, headers: details.headers ?? new Headers() })
  }
}

/**
 * Server-only client. Never expose this instance or its API key to a browser.
 * @deprecated Use Tapaya.checkout.sessions with mode: 'embedded'.
 */
export class TapayaPayments {
  readonly #apiKey: string
  readonly #merchantToken: string | undefined
  readonly #baseUrl: string
  readonly #fetcher: typeof fetch
  readonly #timeoutMs: number

  constructor(apiKey: string, options: TapayaPaymentsOptions = {}) {
    if (typeof window !== 'undefined') throw new TapayaError('TapayaPayments must only run on the server')
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new TapayaError('A merchant API key is required')
    validateTransportOptions(options, (message) => new TapayaError(message))
    const url = validateUrl(options.baseUrl ?? readEnv('TAPAYA_BASE_URL') ?? API_BASE_URLS.sandbox, 'Invalid Tapaya payments API base URL')
    if (url.search || url.hash) throw new TapayaError('The payments API base URL must not contain a query or fragment')
    this.#apiKey = apiKey
    this.#merchantToken = options.merchantToken
    this.#baseUrl = url.href.replace(/\/$/, '')
    this.#fetcher = options.fetch ?? ((input, init) => fetch(input, init))
    this.#timeoutMs = options.timeoutMs ?? 35_000
  }

  async configuration(options: PaymentRequestOptions = {}): Promise<PaymentConfiguration> {
    const response = await this.#request('/configuration', options)
    const result = z.object({
      publishableKey: z.string().regex(/^pk_(dev|test|live)_[0-9a-f]{32}$/),
      environment: z.enum(['development', 'sandbox', 'production']).transform((environment) =>
        environment === 'development' ? 'sandbox' : environment,
      ),
    }).safeParse(response.body)
    if (!result.success) throw this.#responseError(response, 'Invalid payment configuration')
    return { ...result.data, apiOrigin: new URL(this.#baseUrl).origin }
  }

  async prepare(input: CreatePayment, idempotencyKey: string, options: PaymentRequestOptions = {}): Promise<MerchantPayment> {
    const params = createPaymentSchema.safeParse(input)
    if (!params.success) {
      throw new TapayaValidationError('Invalid payment details', params.error.issues.map((issue) => ({
        field: issue.path.join('.'), message: issue.message, code: issue.code,
      })))
    }
    if (params.data.returnUrl !== undefined)
      validateUrl(params.data.returnUrl, 'Invalid returnUrl', (message) => new TapayaValidationError(message, [{ field: 'returnUrl', message }]))
    if (typeof idempotencyKey !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(idempotencyKey)) {
      throw new TapayaValidationError('Invalid idempotency key', [{ field: 'idempotencyKey', message: 'Use 1 to 255 printable ASCII characters without spaces' }])
    }
    const response = await this.#request('', options, params.data, idempotencyKey)
    const result = this.#parse(response)
    const quote = result.shippingQuote
    const selected = params.data.shippingOptions && quote && ['approved', 'accepted'].includes(quote.status)
      ? quote.options.find(option => option.id === quote.selectedOptionId) : undefined
    if (result.merchantOrderId !== params.data.merchantOrderId || result.amount !== (selected?.amount ?? params.data.amount) || result.currency !== params.data.currency) {
      throw this.#responseError(response, 'Payment does not match the order')
    }
    return result
  }

  async retrieve(id: string, options: PaymentRequestOptions = {}): Promise<MerchantPayment> {
    validatePaymentReference(id, 'id')
    return this.#forId(id, await this.#request(`/${encodeURIComponent(id)}`, options))
  }

  async findByOrder(order: string, options: PaymentRequestOptions = {}): Promise<MerchantPayment | null> {
    validatePaymentReference(order, 'merchantOrderId')
    try {
      const response = await this.#request(`?merchantOrderId=${encodeURIComponent(order)}`, options)
      const result = this.#parse(response)
      if (result.merchantOrderId !== order) throw this.#responseError(response, 'Payment does not match the order')
      return result
    } catch (error) {
      if (error instanceof PaymentsApiError && error.status === 404) return null
      throw error
    }
  }

  /** Submit the token once. Recover the original payment after a lost response. */
  async confirm(id: string, token: string, options: PaymentConfirmationOptions = {}): Promise<MerchantPayment> {
    validatePaymentReference(id, 'id')
    if (typeof token !== 'string' || !token.trim() || token.length > 255) {
      throw new TapayaValidationError('Invalid card token', [{ field: 'token', message: 'Use a nonblank token of at most 255 characters' }])
    }
    const details = z.object({ saveCard: z.boolean().optional(), customer: customerInputSchema.nullish(), shippingQuote: shippingConfirmationSchema.nullish() }).safeParse(options)
    if (!details.success) throw new TapayaValidationError('Invalid confirmation details', details.error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })))
    return this.#forId(id, await this.#request(`/${encodeURIComponent(id)}/confirm`, options, { token, paymentMethod: 'card', ...details.data }))
  }

  async approveShippingQuote(id: string, approval: ShippingQuoteApproval, options: PaymentRequestOptions = {}): Promise<ShippingQuote> {
    validatePaymentReference(id, 'id')
    const input = shippingApprovalSchema.safeParse(approval)
    if (!input.success) throw new TapayaValidationError('Invalid shipping quote approval', input.error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })))
    const response = await this.#request(`/${encodeURIComponent(id)}/shipping-quote`, options, input.data)
    const quote = shippingQuoteSchema.safeParse(response.body)
    if (!quote.success) throw this.#responseError(response, 'Invalid shipping quote response')
    if (quote.data.revision !== approval.revision) throw this.#responseError(response, 'Shipping quote revision does not match')
    return quote.data
  }

  async recover(id: string, options: PaymentRequestOptions = {}): Promise<MerchantPayment> {
    validatePaymentReference(id, 'id')
    return this.#forId(id, await this.#request(`/${encodeURIComponent(id)}/recover`, options, {}))
  }

  /** Permanently end browser access. Does not cancel the payment or stop server recovery. */
  async revokeClientSecret(id: string, options: PaymentRequestOptions = {}): Promise<void> {
    validatePaymentReference(id, 'id')
    await this.#request(`/${encodeURIComponent(id)}/revoke-client-secret`, options, {}, undefined, true)
  }

  #forId(id: string, response: HttpResponse): MerchantPayment {
    const result = this.#parse(response)
    if (normalizePaymentId(result.id) !== normalizePaymentId(id)) throw this.#responseError(response, 'Payment identity does not match')
    return result
  }

  #parse(response: HttpResponse): MerchantPayment {
    const result = merchantPaymentSchema.safeParse(response.body)
    if (!result.success) throw this.#responseError(response, 'Invalid payment response')
    if (result.data.clientSecret !== null && result.data.clientSecret.slice(0, 32) !== normalizePaymentId(result.data.id)) {
      throw this.#responseError(response, 'Client secret does not match the payment')
    }
    return result.data
  }

  #responseError(response: HttpResponse, message: string): PaymentsApiError {
    return new PaymentsApiError(response.status, message, { headers: response.headers })
  }

  async #request(path: string, options: PaymentRequestOptions, body?: unknown, key?: string, noContent = false): Promise<HttpResponse> {
    validateTransportOptions(options, (message, field) => new TapayaValidationError(message, [{ field, message }]))
    const { signal } = options
    signal?.throwIfAborted()
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs
    const timeout = AbortSignal.timeout(timeoutMs)
    let response: Response
    let text: string
    try {
      response = await this.#fetcher(`${this.#baseUrl}/merchant/payments${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.#apiKey}`,
          ...((options.merchantToken ?? this.#merchantToken) === undefined ? {} : {
            'X-Tapaya-Merchant-Token': options.merchantToken ?? this.#merchantToken,
          }),
          'user-agent': USER_AGENT,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      text = await response.text()
    } catch (cause) {
      if (signal?.aborted) throw signal.reason
      if (timeout.aborted) throw new TapayaTimeoutError(`Tapaya request timed out after ${timeoutMs} ms`, { cause })
      throw new TapayaConnectionError('Could not connect to Tapaya', { cause })
    }
    let value: unknown
    try { value = JSON.parse(text) } catch { /* Preserve HTTP failures even when their body is not JSON. */ }
    if (!response.ok) {
      const error = createApiError(response, value)
      throw new PaymentsApiError(response.status, error.message, { headers: error.headers, code: error.code, fieldErrors: error.fieldErrors })
    }
    const result = { status: response.status, headers: response.headers, body: value }
    if (noContent && response.status === 204) return result
    if (noContent || value === undefined) throw this.#responseError(result, 'Invalid payment API response')
    return result
  }
}

function validatePaymentReference(value: string, field: 'id' | 'merchantOrderId'): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || (field === 'id' && (value === '.' || value === '..'))) {
    throw new TapayaValidationError(`Invalid ${field}`, [{ field, message: `Invalid ${field}` }])
  }
}

// The backend parses Guid route parameters, then serializes IDs in lowercase dashed form.
function normalizePaymentId(id: string): string {
  const value = id.trim().replace(/^(?:\{(.*)\}|\((.*)\))$/, '$1$2')
  if (/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value)) {
    return value.replaceAll('-', '').toLowerCase()
  }
  return id
}
