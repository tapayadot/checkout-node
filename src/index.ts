import { z } from 'zod/v4'

export const VERSION = '0.2.0'

const USER_AGENT = `tapaya-checkout-js/${VERSION}`
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RETRIES = 2
const INITIAL_RETRY_DELAY_MS = 500
const MAX_RETRY_DELAY_MS = 8_000
// Longer waits would hold up the caller's request. Callers can read retryAfterMs and retry later instead.
const MAX_RETRY_AFTER_MS = 10_000
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])
const API_BASE_URLS = {
  development: 'https://api.dev.tapaya.com',
  sandbox: 'https://api.sandbox.tapaya.com',
  production: 'https://api.tapaya.com',
}
const MAX_INT32 = 2_147_483_647
// 409 error code: a request with the same Idempotency-Key is still in progress.
const IDEMPOTENCY_IN_PROGRESS = 'API-0024'

export type TapayaEnvironment = 'development' | 'sandbox' | 'production'

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
  /** Billing address. Send only the fields you collect. */
  billingAddress?: CheckoutContactAddress | null
  /** Shipping address. Send only the fields you collect. */
  shippingAddress?: CheckoutContactAddress | null
}

type CheckoutSessionFields = {
  /**
   * Your order reference, at most 200 characters. All payment attempts for this order, hosted or embedded, share it,
   * and at most one can succeed. A new session for the same unpaid order replaces the previous one.
   */
  merchantOrderId: string
  /** Final total, including tax and shipping, in minor units: an integer between 1 and 2,147,483,647. */
  amount: number
  /** Three-letter ISO 4217 currency code, such as `EUR`. Tapaya stores it uppercase. */
  currency: string
  /** Language of the hosted page, such as `en`. Defaults to `en`. */
  locale?: string | null
  /** Return URL after payment. Defaults to the URL in your Checkout settings. */
  successUrl?: string | null
  /** Return URL when the customer cancels. Defaults to the URL in your Checkout settings. */
  cancelUrl?: string | null
  /** Products shown on the hosted page. */
  items?: CheckoutItem[] | null
  /** Tax included in `amount`, in minor units. */
  tax?: number | null
  /** Shipping included in `amount`, in minor units. */
  shipping?: number | null
  /** Customer details to prefill on the hosted page. */
  customer?: CheckoutCustomer | null
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
  | 'unpaid' | 'successful' | 'failed' | 'cancelled' | 'action_needed' | (string & {})

export type HostedCheckoutSession = {
  mode: 'hosted'
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
  /** Tax included in `amount`, in minor units. `0` when not sent. */
  tax: number
  /** Shipping included in `amount`, in minor units. `0` when not sent. */
  shipping: number
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
   * `open` while the order can still be paid or a result is pending, `completed` once paid, and
   * `ended` after a cancellation or a decline that allows no further attempt.
   */
  status: 'open' | 'completed' | 'ended'
  paymentStatus: 'unpaid' | 'successful' | 'failed' | 'pending' | 'action_needed' | 'cancelled'
}

export type CheckoutSession = HostedCheckoutSession | EmbeddedCheckoutSession

/** What your prepare endpoint returns to the browser SDK (`@tapayadot/checkout/client`). */
export type { PreparedPayment } from './client/types.js'

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

// Only the params type allows taxRate or taxBreakdown, not both. The API enforces it at runtime.
const createSessionSchema = z.object({
  merchantOrderId: z.string().max(200).refine((value) => value.trim().length > 0),
  amount: z.number().int().positive().max(MAX_INT32),
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
  customer: z.object({
    email: z.string().max(254).nullish(),
    billingAddress: contactAddressSchema.nullish(),
    shippingAddress: contactAddressSchema.nullish(),
  }).nullish(),
}) satisfies z.ZodType<CheckoutSessionFields & { taxRate?: number | null, taxBreakdown?: TaxBreakdownEntry[] | null }>

// Responses: check only what the SDK relies on, so new values and looser data do not break callers.
const sessionSchema = z.object({
  id: z.string().min(1),
  url: z.string(),
  merchantOrderId: z.string(),
  status: z.string(),
  paymentStatus: z.string(),
  amount: z.number(),
  currency: z.string(),
  tax: z.number().default(0),
  shipping: z.number().default(0),
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
  /** Selects the API URL when `baseUrl` is not set. Defaults to `TAPAYA_ENVIRONMENT`, then `sandbox`. */
  environment?: TapayaEnvironment
  /** Embedded API overrides. Defaults to this client's API URL, fetch and timeout. */
  embedded?: TapayaPaymentsOptions
  /** Overrides the API URL. Must use HTTPS, except for local hosts outside `NODE_ENV=production`. */
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
  readonly checkout: {
    readonly sessions: CheckoutSessions
    configuration(options?: PaymentRequestOptions): Promise<PaymentConfiguration>
  }

  constructor(apiKey: string | undefined = readEnv('TAPAYA_SECRET_KEY'), options: TapayaOptions = {}) {
    if (!apiKey?.trim()) throw new TapayaError('Tapaya API key is required')
    validateTransportOptions(options, (message) => new TapayaError(message))
    const client = new HttpClient({
      apiKey,
      merchantToken: options.merchantToken,
      baseUrl: validateUrl(options.baseUrl ?? environmentBaseUrl(options.environment), 'Invalid Tapaya API base URL'),
      fetch: options.fetch ?? ((input, init) => fetch(input, init)),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    })
    const embeddedOptions: TapayaPaymentsOptions = {
      merchantToken: options.merchantToken,
      baseUrl: options.baseUrl ?? environmentBaseUrl(options.environment),
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      ...options.embedded,
    }
    const sessions = new CheckoutSessions(client, () => {
      if (embeddedOptions.baseUrl === API_BASE_URLS.production)
        throw new TapayaError('Embedded checkout is not available in production yet')
      return new TapayaPayments(apiKey, embeddedOptions)
    })
    this.checkout = { sessions, configuration: (requestOptions) => sessions.configuration(requestOptions) }
  }
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

  /** Alias for retrieve. Omitted mode selects hosted checkout. */
  get(id: string, options?: RetrieveHostedSessionOptions): Promise<HostedCheckoutSession>
  get(id: string, options: RetrieveEmbeddedSessionOptions): Promise<EmbeddedCheckoutSession>
  get(id: string, options: RetrieveSessionOptions): Promise<CheckoutSession>
  get(id: string, options: RetrieveSessionOptions = {}): Promise<CheckoutSession> {
    return this.retrieve(id, options)
  }

  retrieve(id: string, options?: RetrieveHostedSessionOptions): Promise<HostedCheckoutSession>
  retrieve(id: string, options: RetrieveEmbeddedSessionOptions): Promise<EmbeddedCheckoutSession>
  retrieve(id: string, options: RetrieveSessionOptions): Promise<CheckoutSession>
  async retrieve(id: string, options: RetrieveSessionOptions = {}): Promise<CheckoutSession> {
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
    const existing = await this.verify(order, options)
    if (existing && !((existing.paymentStatus === 'failed' || existing.paymentStatus === 'cancelled') && existing.retryAllowed)) return existing
    let key = `${order.merchantOrderId}:${existing ? `after:${existing.id}` : 'initial'}`
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
   * Fulfill only when the result has `status: 'completed'`.
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
  async confirm(id: string, token: string, options: PaymentRequestOptions = {}): Promise<EmbeddedCheckoutSession> {
    validateEmbeddedRequestOptions(options)
    return embeddedSession(await this.#embedded().confirm(id, token, options))
  }

  async recover(id: string, options: PaymentRequestOptions = {}): Promise<EmbeddedCheckoutSession> {
    validateEmbeddedRequestOptions(options)
    return embeddedSession(await this.#embedded().recover(id, options))
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
    status: paymentStatus === 'successful'
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

function environmentBaseUrl(environment?: TapayaEnvironment): string {
  const name = environment ?? readEnv('TAPAYA_ENVIRONMENT') ?? 'sandbox'
  if (name !== 'development' && name !== 'sandbox' && name !== 'production') {
    throw new TapayaError('Invalid Tapaya environment: expected development, sandbox or production')
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

/** Authoritative status of an embedded payment attempt. HTTP 200 alone does not mean payment succeeded. */
export type PaymentStatus =
  | 'ready' | 'successful' | 'declined' | 'pending' | 'action_required' | 'cancelled'

export type PaymentAddress = CheckoutContactAddress

export type CreatePayment = {
  /** Stable order reference, at most 200 characters. */
  merchantOrderId: string
  /** Final total in integer minor units, between 1 and 2,147,483,647. */
  amount: number
  /** Uppercase three-letter ISO currency code. */
  currency: string
  /** Optional customer risk and billing details. Omit fields you do not collect. */
  customer?: CheckoutCustomer | null
}

export type MerchantPayment = {
  id: string
  merchantOrderId: string
  amount: number
  currency: string
  status: PaymentStatus
  retryAllowed: boolean
  /** Pass to the browser only. Null after expiry or revocation; server status reads still work. Never log or persist it. */
  clientSecret: string | null
}

export type PaymentConfiguration = {
  /** Safe to expose in the browser. */
  publishableKey: string
  environment: 'development'
  /** Origin of the Tapaya API this server talks to. Pass it to the browser loader as `apiOrigin`. */
  apiOrigin: string
}

/** Embedded requests never retry automatically, including charge submissions. */
export type PaymentRequestOptions = Pick<RequestOptions, 'signal' | 'timeoutMs' | 'merchantToken'>
export type TapayaPaymentsOptions = Pick<PaymentRequestOptions, 'timeoutMs' | 'merchantToken'> & {
  baseUrl?: string
  fetch?: typeof fetch
}

const createPaymentSchema = z.object({
  merchantOrderId: z.string().max(200).refine((value) => value.trim().length > 0),
  amount: z.number().int().positive().max(MAX_INT32),
  currency: z.string().regex(/^[A-Z]{3}$/),
  customer: z.object({
    email: z.string().max(254).nullish(),
    billingAddress: contactAddressSchema.nullish(),
    shippingAddress: contactAddressSchema.nullish(),
  }).nullish(),
}) satisfies z.ZodType<CreatePayment>

const merchantPaymentSchema = z.object({
  id: z.string().min(1),
  merchantOrderId: z.string(),
  amount: z.number().int().positive().max(MAX_INT32),
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: z.enum(['ready', 'successful', 'declined', 'pending', 'action_required', 'cancelled']),
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
    const url = validateUrl(options.baseUrl ?? API_BASE_URLS.sandbox, 'Invalid Tapaya payments API base URL')
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
      publishableKey: z.string().regex(/^pk_dev_[0-9a-f]{32}$/),
      environment: z.literal('development'),
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
    if (typeof idempotencyKey !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(idempotencyKey)) {
      throw new TapayaValidationError('Invalid idempotency key', [{ field: 'idempotencyKey', message: 'Use 1 to 255 printable ASCII characters without spaces' }])
    }
    const response = await this.#request('', options, params.data, idempotencyKey)
    const result = this.#parse(response)
    if (result.merchantOrderId !== params.data.merchantOrderId || result.amount !== params.data.amount || result.currency !== params.data.currency) {
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
  async confirm(id: string, token: string, options: PaymentRequestOptions = {}): Promise<MerchantPayment> {
    validatePaymentReference(id, 'id')
    if (typeof token !== 'string' || !token.trim() || token.length > 255) {
      throw new TapayaValidationError('Invalid card token', [{ field: 'token', message: 'Use a nonblank token of at most 255 characters' }])
    }
    return this.#forId(id, await this.#request(`/${encodeURIComponent(id)}/confirm`, options, { token, paymentMethod: 'card' }))
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
