import { z } from 'zod/v4'

export const VERSION = '0.1.0'

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
  /** Billing address. Send only the fields you collect. */
  billingAddress?: CheckoutContactAddress | null
  /** Shipping address. Send only the fields you collect. */
  shippingAddress?: CheckoutContactAddress | null
}

type CheckoutSessionFields = {
  /** Your order reference. Tapaya generates one if you omit it. */
  merchantOrderId?: string | null
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

export type CreateCheckoutSessionParams = CheckoutSessionFields & CheckoutSessionTaxRate

/** Session status. New values may be added. */
export type CheckoutSessionStatus = 'open' | 'completed' | 'expired' | (string & {})

/** Status of the latest payment attempt. New values may be added. */
export type CheckoutPaymentStatus =
  | 'unpaid' | 'successful' | 'failed' | 'cancelled' | 'refunded' | 'action_needed' | (string & {})

export type CheckoutSession = {
  /** Session ID, such as `cs_Y7u2d`. */
  id: string
  /** Hosted payment page. Redirect to it unchanged. */
  url: string
  /** Your order reference, or the one Tapaya generated. */
  merchantOrderId: string
  /** `open`, `completed`, or `expired`. Sessions expire after 30 minutes. */
  status: CheckoutSessionStatus
  /** `unpaid`, `successful`, `failed`, `cancelled`, `refunded`, or `action_needed`. */
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
  merchantOrderId: z.string().nullish(),
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
}) satisfies z.ZodType<CheckoutSession>

export type TapayaOptions = {
  /** Selects the API URL when `baseUrl` is not set. Defaults to `TAPAYA_ENVIRONMENT`, then `sandbox`. */
  environment?: TapayaEnvironment
  /** Overrides the API URL. Must use HTTPS, except for local hosts outside `NODE_ENV=production`. */
  baseUrl?: string
  /** Custom `fetch` implementation. Defaults to the global `fetch`. */
  fetch?: typeof fetch
  /** Timeout for each attempt, in milliseconds. Defaults to `30000`. */
  timeoutMs?: number
  /** Retries after a connection error, timeout, HTTP 429, 502, 503, or 504, or a create still in progress. Defaults to `2`. */
  maxRetries?: number
}

export type RequestOptions = {
  /** Aborts the request immediately, without retrying. The method rejects with the signal's reason. */
  signal?: AbortSignal
  /** Overrides the client's timeout for each attempt, in milliseconds. */
  timeoutMs?: number
  /** Overrides the client's retry count. */
  maxRetries?: number
}

export type CreateSessionOptions = RequestOptions & {
  /** Sent as `Idempotency-Key`, up to 255 printable ASCII characters. Defaults to a random UUID per call. */
  idempotencyKey?: string
}

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

export class Tapaya {
  readonly checkout: { readonly sessions: CheckoutSessions }

  constructor(apiKey: string | undefined = readEnv('TAPAYA_SECRET_KEY'), options: TapayaOptions = {}) {
    if (!apiKey?.trim()) throw new TapayaError('Tapaya API key is required')
    validateTransportOptions(options, (message) => new TapayaError(message))
    const client = new HttpClient({
      apiKey,
      baseUrl: validateUrl(options.baseUrl ?? environmentBaseUrl(options.environment), 'Invalid Tapaya API base URL'),
      fetch: options.fetch ?? ((input, init) => fetch(input, init)),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    })
    this.checkout = { sessions: new CheckoutSessions(client) }
  }
}

class CheckoutSessions {
  readonly #client: HttpClient

  constructor(client: HttpClient) {
    this.#client = client
  }

  async create(params: CreateCheckoutSessionParams, options: CreateSessionOptions = {}): Promise<CheckoutSession> {
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
    if (!idempotencyKey.trim() || idempotencyKey.length > 255 || /[^\x20-\x7e]/.test(idempotencyKey)) {
      throw new TapayaValidationError('Idempotency key must be between 1 and 255 characters and safe for an HTTP header')
    }
    // Choose the key and serialize once so retries replay the exact request.
    const response = await this.#client.request('POST', '/merchant/checkout-sessions', options, {
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input.data),
    })
    return parseSession(response)
  }

  async retrieve(id: string, options: RequestOptions = {}): Promise<CheckoutSession> {
    if (!id.trim() || id.length > 200 || id === '.' || id === '..') {
      throw new TapayaValidationError('Invalid checkout session ID', [{ field: 'id', message: 'Invalid checkout session ID' }])
    }
    const response = await this.#client.request('GET', `/merchant/checkout-sessions/${encodeURIComponent(id)}`, options)
    return parseSession(response)
  }
}

export type { CheckoutSessions }

function parseSession({ body, status, headers }: HttpResponse): CheckoutSession {
  const result = sessionSchema.safeParse(body)
  if (!result.success) throw new TapayaResponseError('Tapaya returned an invalid checkout session', status, headers)
  validateUrl(
    result.data.url,
    'Tapaya returned an unexpected checkout URL',
    (message) => new TapayaResponseError(message, status, headers),
  )
  return result.data
}

type HttpResponse = { status: number, headers: Headers, body: unknown }

type HttpClientConfig = {
  apiKey: string
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
  options: { timeoutMs?: number, maxRetries?: number },
  createError: (message: string, field: 'timeoutMs' | 'maxRetries') => TapayaError,
): void {
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
  if (name !== 'sandbox' && name !== 'production') {
    throw new TapayaError('Invalid Tapaya environment: expected sandbox or production')
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
