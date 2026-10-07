# Tapaya Checkout SDK

TypeScript SDK for [Tapaya Hosted Checkout](https://docs.tapaya.com/online/integration/hosted_checkout) and embedded card payments. This README describes version 0.2.0.
Create a Checkout session for an order, redirect the customer to the Tapaya-hosted payment page, and verify the
payment on your server before fulfilling the order. For embedded card fields, the same package provides the browser
SDK (`@tapayadot/checkout/client`) and a React hook (`@tapayadot/checkout/react`).

The server client requires Node.js 22.13 or newer. It uses only standard Web APIs (`fetch`, Web Crypto, and `AbortSignal`) and
does not import Node.js modules.

```sh
npm install @tapayadot/checkout
```

## Upgrade from 0.1.x

- Set `merchantOrderId` on every hosted session creation. It is now required, must contain
  non-whitespace text, and must be at most 200 characters.
- Keep hosted idempotency keys at most 250 characters. The previous limit was 255.
- `CheckoutSession` is now a union of `HostedCheckoutSession` and `EmbeddedCheckoutSession`.
  Use `HostedCheckoutSession` for hosted-only annotations, or check `session.mode` before
  accessing mode-specific fields. Hosted responses now include `mode: 'hosted'`.
- Existing `checkout.sessions.create(...)` and `get(id)` calls still default to hosted checkout.
  `retrieve(id)` is also available.
- Import browser code from `@tapayadot/checkout/client` and the React hook from
  `@tapayadot/checkout/react`. The root entry is for server code.

The browser loader targets Tapaya.js at `/checkout/0.1.0/checkout.js` on
`https://js.tapaya.com`. Its version does not follow this package's server releases.
Set `origin` to your local Tapaya.js server for local development.

## Quick start

In the Tapaya Platform, open **Checkout**, add your merchant, and create a merchant checkout key under the
merchant's **Settings**. Store the `tapaya_test_…` key in your server environment. Never expose it to browser code.
A platform serving many merchants uses the organization Secret key instead; see [Select a merchant](#select-a-merchant).

```sh
TAPAYA_SECRET_KEY=tapaya_test_...
TAPAYA_ENVIRONMENT=sandbox
```

Create the client in server-only code:

```ts
import { Tapaya } from '@tapayadot/checkout'

const tapaya = new Tapaya(process.env.TAPAYA_SECRET_KEY)
```

When the customer checks out, persist the order with a unique attempt key, then create a session.
`merchantOrderId` is required, and an order can be paid only once. Amounts are integers in minor units, so `12100`
is EUR 121.00.

```ts
const session = await tapaya.checkout.sessions.create(
  {
    merchantOrderId: order.id,
    amount: order.totalInMinorUnits,
    currency: order.currency,
    successUrl: 'https://shop.example/checkout/return',
    cancelUrl: 'https://shop.example/checkout/cancel',
  },
  { idempotencyKey: order.checkoutAttemptKey },
)

// Save session.id with the order, then redirect with the URL exactly as returned.
return Response.redirect(session.url, 303)
```

When the customer returns to your success or cancel URL, get the session and compare it with the stored order.
A redirect alone never proves payment.

```ts
const current = await tapaya.checkout.sessions.get(order.checkoutSessionId)

const matches =
  current.merchantOrderId === order.id &&
  current.amount === order.totalInMinorUnits &&
  current.currency === order.currency

if (matches && current.paymentStatus === 'successful') {
  await fulfillOnce(order)
}
```

Customers can close the tab before they return, and there are no webhooks yet, so also check unresolved sessions
from a background job. The
[Quick Start Guide](https://docs.tapaya.com/online/getting-started/quick_start_guide) covers Checkout settings,
return URLs, and test cards.

## Configuration

```ts
const tapaya = new Tapaya(apiKey, {
  environment: 'sandbox',
  timeoutMs: 30_000,
  maxRetries: 2,
})
```

| Option | Default | Description |
|---|---|---|
| `apiKey` (first argument) | `TAPAYA_SECRET_KEY` | A merchant checkout key, or the organization Secret key in platform mode. |
| `merchantToken` | None | Merchant token, sent as `X-Tapaya-Merchant-Token`. Required in platform mode. |
| `environment` | `TAPAYA_ENVIRONMENT`, then `sandbox` | `development` (`https://api.dev.tapaya.com`), `sandbox` (`https://api.sandbox.tapaya.com`), or `production` (`https://api.tapaya.com`). Checkout is not available in production yet. |
| `baseUrl` | Set by `environment` | Overrides the API URL for hosted and embedded calls. |
| `timeoutMs` | `30000` | Timeout for each attempt, in milliseconds. |
| `maxRetries` | `2` | Retries after a network error, a timeout, HTTP 429, 502, 503, or 504, or a create still in progress. |
| `fetch` | Global `fetch` | Custom `fetch` implementation, for example to add a proxy or instrumentation. |
| `embedded` | Same API as hosted, 35,000 ms timeout | Overrides `{ baseUrl, fetch, timeoutMs }` for embedded checkout. Top-level values apply to both flows unless overridden here. |

The client resolves the API key and API environment once, when it is constructed. Use a key that matches the
selected environment. API, return, and hosted checkout URLs must use HTTPS, except that HTTP is allowed for
`localhost`, `127.0.0.1`, and `[::1]` outside `NODE_ENV=production`. The SDK checks the current `NODE_ENV` each
time it validates a local HTTP URL.

Each method also accepts `signal`, `timeoutMs`, and `maxRetries` for a single request:

```ts
const current = await tapaya.checkout.sessions.get(sessionId, {
  signal: request.signal,
  timeoutMs: 5_000,
})
```

When the signal aborts, the method stops immediately, without retrying, and rejects with the signal's reason.

## Checkout sessions

### Select a merchant

There are two modes. Both send the key as `Authorization: Bearer <key>`.

- **Merchant mode** (one shop): a merchant checkout key resolves to exactly its merchant. Use `new Tapaya()`
  without a `merchantToken`. If you send one, it must name the same merchant.
- **Platform mode** (one backend for many merchants, such as a marketplace): use the organization Secret key from
  the Platform's **API keys** page and send a merchant token on **every** request. There is no default merchant;
  a request without a token fails with `TapayaAuthenticationError` (HTTP 401). The merchant must belong to the
  key's organization. Copy tokens from the merchants table in the Platform's **Checkout** settings.

Set a default token on the client, or pass `merchantToken` for each request:

```ts
const tapaya = new Tapaya(process.env.TAPAYA_SECRET_KEY, { merchantToken: order.merchantToken })
const session = await tapaya.checkout.sessions.create(params, {
  merchantToken: order.merchantToken,
  idempotencyKey: order.checkoutAttemptKey,
})
const current = await tapaya.checkout.sessions.retrieve(session.id, {
  merchantToken: order.merchantToken,
})
```

The option applies to hosted and embedded checkout. Use the same merchant token for subsequent requests.

Merchant checkout keys are created in the Platform under **Checkout** → merchant **Settings**. They are shown once,
stored only as a hash, and can be revoked independently. Give a merchant's own backend its merchant key, never the
organization Secret key.

### Create a session

`tapaya.checkout.sessions.create(params, options?)` selects hosted checkout when `mode` is omitted or `'hosted'`.
For `mode: 'embedded'`, see [Embedded checkout](#embedded-checkout). Hosted checkout requires `merchantOrderId`,
`amount`, and `currency`. `merchantOrderId` is your order reference, 1 to 200 characters. `amount` is the final total,
including tax and shipping, an integer between 1 and 2,147,483,647 minor units. `currency` is a three-letter ISO 4217
code. Tapaya stores and returns it uppercase.

Hosted and embedded checkout share one payment engine. A merchant can have at most one successful payment per
`merchantOrderId`; different merchants can reuse the same IDs. A new session for an unpaid order replaces the
previous unpaid session, whose URL then reports `expired`. Creating a session for an order that is paid or has a
payment in progress fails with `TapayaConflictError`.

Optional fields:

| Field | Description |
|---|---|
| `locale` | Language of the hosted page, such as `en`. Defaults to `en`. |
| `successUrl`, `cancelUrl` | Return URLs. Default to the URLs in your Checkout settings. |
| `tax`, `shipping` | Tax and shipping included in `amount`, in minor units. |
| `taxRate` | Single tax rate in percentage points, such as `21`. |
| `taxBreakdown` | Tax per rate, `[{ taxRate, tax }]`, for orders with mixed rates. Use instead of `taxRate`: the types reject both together. |
| `items` | Products shown on the hosted page: `reference`, `name`, `description`, `imageUrl`, `quantity`, and `unitAmount`. Items are for display only and do not change the amount charged. |
| `customer` | Optional `email`, `billingAddress`, and `shippingAddress`. Send only the details you collect. |

Before sending, the SDK checks types, required fields, integer amounts, the currency format, and a maximum email
length of 254 characters. Return URLs must be absolute HTTPS URLs, with the local HTTP exception described under
[Configuration](#configuration). Tapaya validates business rules such as email format, address limits, and country
codes, and reports problems as `TapayaInvalidRequestError`. See
[Checkout Sessions](https://docs.tapaya.com/online/integration/api_integration#checkout-sessions) for field rules,
tax totals, and customer address limits.

### Get a session

`tapaya.checkout.sessions.retrieve(id, options?)` returns the current state of a hosted session.
`get` remains an alias for `retrieve`. Pass `{ mode: 'embedded' }` to retrieve an embedded session.

Hosted creation and retrieval return a `HostedCheckoutSession`. The `CheckoutSession` type is a union
of hosted and embedded sessions, distinguished by `mode`:

| Field | Description |
|---|---|
| `mode` | `'hosted'`. |
| `id` | Session ID, such as `cs_Y7u2d`. |
| `url` | Hosted payment page. Redirect to it unchanged. |
| `merchantOrderId`, `amount`, `currency` | Order details to compare with your stored order. |
| `status` | `open`, `completed`, or `expired`. Sessions accept new payments for 30 minutes; a payment already submitted still completes. New values may be added. |
| `paymentStatus` | `unpaid`, `successful`, `failed`, `cancelled`, or `action_needed`. New values may be added. |
| `paymentReference` | Token of the latest payment attempt, or `null` before the first attempt. |
| `tax`, `shipping`, `taxRate`, `taxBreakdown` | Totals sent when the session was created. Default to `0`, `0`, `null`, and `[]`. |
| `items` | Items sent when the session was created, or an empty array. |
| `createdAt`, `expiresAt`, `completedAt` | ISO 8601 timestamps. `completedAt` is `null` until payment succeeds. |

Handle unknown `status` and `paymentStatus` values, for example by treating them as not yet paid. Only
`paymentStatus: 'successful'` proves payment.

A declined card is a payment outcome, not an error. The session stays `open` with `paymentStatus: 'failed'`, and
the customer can try another card or wallet. Submitting the same card token again never charges twice. While
Tapaya confirms an uncertain outcome, the session stays `open` and `unpaid`; poll it from your server.

## Idempotency and retries

Every create request sends an `Idempotency-Key`. Tapaya accepts keys of at most 250 characters. If you omit `idempotencyKey`, the SDK generates a random key for
each call. Within that call, retries reuse the key, so a retry never creates a second session.

To stay safe across separate calls and process restarts, store a key with the order and pass it every time you
create a session for that attempt, with the same parameters. Tapaya returns the original session instead of
creating a new one. Use a new key only for a new checkout attempt, never to retry an uncertain result.

A repeated hosted create returns the same session with its current `status` and `paymentStatus`.
Call `tapaya.checkout.sessions.get(session.id)` to check the status again before fulfilling the order.

For the same merchant, hosted retries must use the same request body and credential mode: merchant checkout key
or organization Secret key. Changing either returns HTTP 409 with code `API-0025`. Switching credential modes
conflicts even when the body is identical, because each mode uses its own redirect settings.

Hosted checkout retries creation and retrieval after network errors, timeouts, and HTTP 429, 502, 503, and 504. It also retries a
create that fails with HTTP 409 `API-0024`. Retries send the same key and body, so they return the original session. The SDK
waits between attempts with exponential backoff and jitter, and honors `Retry-After` up to 10 seconds. When Tapaya
asks for a longer wait, the SDK stops retrying and throws the error for that HTTP status: `TapayaRateLimitError`
for 429, `TapayaServerError` for 502, 503, or 504, or `TapayaConflictError` for 409. Only `TapayaRateLimitError`
exposes the requested delay as `retryAfterMs`; other HTTP errors retain the `Retry-After` header in `headers`.
All retries share the `maxRetries` budget. Set `maxRetries: 0` to turn retries off.

Never switch to a new key to get past an uncertain result. The original request may already have created a
session; a new key for the same unpaid order replaces it.

## Errors

Every error the SDK throws extends `TapayaError`, except an aborted request, which rejects with the signal's reason.

| Error | When |
|---|---|
| `TapayaValidationError` | Parameters failed validation before a request was sent. |
| `TapayaAuthenticationError` | HTTP 401: the key is missing or invalid, the merchant token is missing in platform mode, or the token does not match an active merchant. |
| `TapayaInvalidRequestError` | HTTP 400 or 422: Tapaya rejected the parameters. |
| `TapayaPermissionError` | HTTP 403. |
| `TapayaNotFoundError` | HTTP 404: the session does not exist for this merchant. |
| `TapayaConflictError` | HTTP 409. `code` is `API-0025` when the idempotency key was already used with different parameters. Creating a session for an order that is already paid or has a payment in progress also returns 409. |
| `TapayaRateLimitError` | HTTP 429 after retries, or right away when `Retry-After` is longer than 10 seconds. `retryAfterMs` holds the requested delay, when Tapaya sends one. |
| `TapayaServerError` | HTTP 5xx. Only 502, 503, and 504 are retried, unless retries are disabled or `Retry-After` exceeds 10 seconds. Other 5xx statuses fail immediately. |
| `TapayaApiError` | Base class of the HTTP errors above, and any other HTTP error status. |
| `TapayaOrderMismatchError` | Embedded `prepare` or `verify` found a session whose amount or currency differ from your order. `sessionId` identifies it. |
| `TapayaConnectionError` | The request failed or the response was lost after retries. The original error is in `cause`. |
| `TapayaTimeoutError` | A `TapayaConnectionError` for an attempt that exceeded `timeoutMs`. |
| `TapayaResponseError` | Tapaya returned a response the SDK could not read. |

HTTP errors carry `status`, the Tapaya error `code`, `fieldErrors` (`{ field, message, code? }[]`), the
response `headers`, and `requestId` from the `X-Request-Id` header, when present. The backend does not currently
set this header. Include the session ID or order reference and the request time in support requests, along with
`requestId` if available. `TapayaResponseError` carries `status`, `headers`, and `requestId` too.
`TapayaValidationError` carries `fieldErrors` too, with `field` set to the parameter path, such as `customer.email`.

```ts
import { TapayaConnectionError, TapayaError, TapayaValidationError } from '@tapayadot/checkout'

try {
  const session = await tapaya.checkout.sessions.create(params, { idempotencyKey })
  return Response.redirect(session.url, 303)
} catch (error) {
  if (error instanceof TapayaValidationError) {
    console.error(error.fieldErrors)
  } else if (error instanceof TapayaConnectionError) {
    // The outcome is unknown. Retry later with the same idempotency key.
  } else if (error instanceof TapayaError) {
    console.error(error.message)
  }
  throw error
}
```

## Embedded checkout

Embedded checkout requires version 0.2.0 or newer.

Both checkout experiences use `Tapaya.checkout.sessions`. Embedded checkout uses the
[browser card fields](#browser-card-fields) from this package. Your server needs two calls: `prepare` before the shopper pays, and `verify`
before you fulfill. Embedded calls use the same `environment` or `baseUrl` as hosted calls, so they default to
`https://api.sandbox.tapaya.com`. Embedded checkout supports test card payments in development and sandbox.
The SDK rejects embedded calls in production. Keep the key on your server.

```ts
import { Tapaya } from '@tapayadot/checkout'

const tapaya = new Tapaya(process.env.TAPAYA_SECRET_KEY!)
const order = { merchantOrderId: 'order-1042', amount: 12100, currency: 'EUR' }

// Your POST /api/payments endpoint. The browser SDK calls it on load and on submit.
const session = await tapaya.checkout.sessions.prepare(order)
return Response.json({ clientSecret: session.clientSecret, status: session.status })

// Your confirmation page and reconciliation job.
const current = await tapaya.checkout.sessions.verify(order)
if (current?.status === 'completed') await fulfillOnce(order)
```

`prepare(order)` returns the order's session. It creates the first attempt, reuses an unresolved one,
and creates the next attempt after a decline. Every decline sets `retryAllowed`, so the shopper can try
another card for the same order. It derives the idempotency keys
itself, so a lost response or a concurrent call replays the same attempt. Call it on every page load and
every submission. `order` takes `merchantOrderId`, `amount`, uppercase `currency`, and optional
`customer` details. Hosted-only fields such as `items`, `tax`, and return URLs are rejected.

`verify(order)` reads the order's current session without creating one, and returns `null` before the
first attempt. Both methods throw `TapayaOrderMismatchError` when the session's amount or currency differ
from `order`, so a changed cart is never paid at the old total.

The session's `status` tells you what to do:

| `status` | Meaning |
|---|---|
| `open` | The shopper can pay, or a payment is still being processed. Keep the order reserved. |
| `completed` | Paid. Fulfill the order once. |
| `ended` | Cancelled. Release the order; a new checkout needs a new `merchantOrderId`. |

The session also contains `mode: 'embedded'`, `url: null`, `clientSecret`, `retryAllowed`,
`paymentStatus`, and the order details. Its `id` is the underlying merchant payment ID. The SDK maps
payment states `ready`, `declined`, and `action_required` to `paymentStatus` values `unpaid`, `failed`,
and `action_needed`. Other payment states remain unchanged.

Send `clientSecret` only to the shopper authorized to pay this order. Never log or persist it. It is
`null` after 24 hours or explicit revocation; server-side reads still work. After 24 hours, a reservation
that was never submitted becomes `cancelled` when read. An expired browser credential never cancels a
pending charge, so keep reconciling pending payments on your server.

This preview has no webhooks. Run a scheduled job that calls `verify(order)` for unpaid orders, so a
shopper closing the tab does not prevent fulfillment. Embedded checkout never retries requests
automatically. API failures throw `PaymentsApiError`, a `TapayaApiError` subclass, with `status`, `code`,
`fieldErrors`, `headers`, and `requestId`. Invalid arguments throw `TapayaValidationError`; transport
failures throw `TapayaConnectionError` or `TapayaTimeoutError`. A failed request is never evidence of a
decline. Keep diagnostics on your server and show your own shopper-facing text.

### Lower-level methods

`prepare` and `verify` cover most integrations. These methods remain available:

- `tapaya.checkout.configuration()` returns `{ publishableKey, environment: 'development', apiOrigin }`. See
  [Mount the card fields](#mount-the-card-fields).
- `sessions.create({ mode: 'embedded', ...order }, { idempotencyKey })` creates one attempt with your own key.
- `sessions.retrieve(id, { mode: 'embedded' })` and `sessions.findByOrder(merchantOrderId)` read a session
  without comparing it to your order. `findByOrder` returns `null` only for a 404 response.
- `sessions.confirm(id, token)` submits a card token, and `sessions.recover(id)` requests recovery of the
  payment. The browser SDK calls Tapaya directly, so most integrations need neither.

To permanently end browser access, call `tapaya.checkout.sessions.revokeClientSecret(sessionId)`. This
method does not cancel the payment or stop server-side recovery. Repeated calls
succeed, and later merchant reads return `clientSecret: null`.

Use `new Tapaya(apiKey, { embedded: { baseUrl, fetch, timeoutMs } })` to override the embedded API endpoint,
fetch implementation, or per-request timeout. Top-level `environment`, `baseUrl`, `fetch`, and `timeoutMs` apply
unless overridden in `embedded`. The embedded timeout defaults to 35,000 ms. Hosted `maxRetries` never applies
to embedded checkout. Embedded request options reject nonzero `maxRetries`.
Every method accepts a final `{ signal, timeoutMs }` argument. Caller cancellation
rejects with the signal's reason and never retries the request.

```ts
const controller = new AbortController()
const current = await tapaya.checkout.sessions.retrieve(session.id, {
	mode: 'embedded',
	signal: controller.signal,
	timeoutMs: 10_000,
})
```

The endpoint must use HTTPS. HTTP loopback endpoints are accepted for local
development only when `NODE_ENV` is not `production`.

`TapayaPayments` remains available as a deprecated compatibility client. Its `prepare`, `retrieve`,
and other methods keep their existing merchant payment responses. New integrations use `Tapaya` and
`checkout.sessions`; hosted calls without `mode` continue to work.

## Browser card fields

Import the browser SDK from `@tapayadot/checkout/client`, and the React hook from
`@tapayadot/checkout/react`. Neither contains server code, and importing
`@tapayadot/checkout` itself in a browser build throws, so the secret-key client
never reaches a page. Card fields render in a Tapaya-hosted frame; your page never
handles card data, provider keys, or provider scripts.

Your prepare endpoint returns a `PreparedPayment`, exported by both entry points:

```ts
import type { PreparedPayment } from '@tapayadot/checkout'

const session = await tapaya.checkout.sessions.prepare(order)
return Response.json({ clientSecret: session.clientSecret, status: session.status } satisfies PreparedPayment)
```

### Mount the card fields

Call `tapaya.checkout.configuration()` once on your server and pass `publishableKey` and `apiOrigin` to the page.
The card fields require `apiOrigin`: publishable keys start with `pk_dev_` in every environment, so the key cannot
select the API.

```ts
import { loadTapaya } from '@tapayadot/checkout/client'

const tapaya = await loadTapaya(publishableKey, { apiOrigin })
const payment = tapaya.createPayment({
  prepare: '/api/payments',
  locale: 'cs',
  labels: { cardholder: 'Jméno na kartě' }, // optional overrides
  appearance: { variables: { colorText: '#111', borderRadius: '4px' } },
  onChange: ({ canSubmit, busy, outcome }) => {
    payButton.disabled = !canSubmit
    payButton.setAttribute('aria-busy', String(busy))
    if (outcome === 'completed') location.assign(`/orders/${orderId}`)
  },
})
await payment.mount('#card') // an empty element in your form

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  // Run your own form validation first.
  await payment.submit().catch(() => {}) // the frame shows the error
})
```

`prepare: '/api/payments'` sends a same-origin POST with cookies and no body, on
mount and on each submission. Your endpoint returns `{ clientSecret, status }`.
The SDK checks the response and secret before charging, rejects redirects, and
does not retry the request automatically. If you need custom headers, CSRF tokens,
a request body, or a cross-origin endpoint, pass a function instead:
`prepare: async () => (await myRequest()).json()`. It may also return the secret
as a string.

`snapshot.outcome` is all your page needs to follow:

| `outcome` | Show |
| --- | --- |
| `open` | The Pay button, enabled while `canSubmit` is true. A retryable decline stays `open`. |
| `pending` | Progress. The SDK checks the status automatically while the page is visible, backing off from 2 to 30 seconds. |
| `completed` | Your confirmation page, which verifies the order on your server. |
| `ended` | A way to start a new checkout. The payment was cancelled. |

`onChange` also runs when the page loads with an already settled payment, so a
reload after paying opens your confirmation page too.

You can also pass a known `clientSecret` to `createPayment()` instead of
`prepare`, and pay with `submit({ clientSecret })`. `submit('/api/pay')` uses an
endpoint for one submission. A pending payment always checks its current status
instead of charging again.

`loadTapaya` loads Tapaya.js from `https://js.tapaya.com/checkout/0.1.0/checkout.js`.
Development updates use the same path and are cached for five minutes.
Server-only releases of this package do not change the script version.
For local development, pass the origin
that serves Tapaya.js: `loadTapaya(publishableKey, { apiOrigin, origin: 'http://localhost:4191' })`.

Call `payment.destroy()` on teardown. It removes the frame. It cannot cancel a
submitted payment or an issuer challenge.

Loading Tapaya.js times out after 20 seconds. Handle the rejected promise and
call `loadTapaya` again to retry, or use `retryMount()` with the React hook.

#### Without a bundler

```html
<script src="https://js.tapaya.com/checkout/0.1.0/checkout.js"></script>
<script>
  const tapaya = Tapaya('pk_dev_…', { apiOrigin: 'https://api.sandbox.tapaya.com' })
  const payment = tapaya.createPayment({ prepare: '/api/payments' })
  payment.mount('#card')
</script>
```

To pin an exact release, use `/checkout/0.1.0/checkout.js` and the SHA-384 hashes
in that version's `manifest.json` for `integrity` attributes. Channel URLs change
with each compatible fix, so they cannot carry a fixed hash.

#### React

```tsx
import { usePayment } from '@tapayadot/checkout/react'

function CardStep({ publishableKey, apiOrigin }) {
  const payment = usePayment({ publishableKey, apiOrigin, prepare: '/api/payments', locale: 'en' })
  async function pay(event) {
    event.preventDefault()
    await payment.submit().catch(() => {})
  }
  return (
    <form onSubmit={pay}>
      <div ref={payment.fieldRef} />
      <button disabled={!payment.snapshot.canSubmit}>Pay</button>
    </form>
  )
}
```

The hook renders no form or button. Passing `null` instead of options tears the
frame down and clears its remembered payment. `labels` and `appearance` are compared
by value, so inline objects are fine, and an inline `prepare` function never
remounts the fields. A changed `appearance` restyles in place.
Changes to `locale`, `labels`, or the card icon remount after the current operation
finishes and recover the same payment using its secret. Card fields are cleared
by a remount. `retryMount()` retries a load failure or resets a terminal failed
payment after your server has released its order. It does nothing while busy,
pending, awaiting action, or successful.

`payment.clientSecret` exposes the current secret, including one returned by
`prepare`. The hook keeps it in memory for recovery; never log or persist it.

### Payment states

`snapshot.state` is one of `loading`, `ready`, `preparing`, `tokenizing`,
`authenticating`, `submitting`, `recovering`, `successful`, `declined`, `pending`,
`action_required`, `cancelled` or `error`.

- `canSubmit` is true when a new charge may start: `ready`, `error`, or a
  `declined` result (every decline allows a retry).
- `complete` is true when every field is filled and none reports a validation
  error. Validation also runs on submit, so you don't need to gate the Pay button on it.
- `pending` means a charge may be in flight. `submit()` then checks the status
  instead of charging again, and the SDK checks it automatically while the page
  is visible. `recover()` checks it immediately. Never switch to another payment
  method to get around a pending payment.
- An unknown outcome never turns into a decline because time has passed. Tapaya
  keeps reconciling it.
- `cancelled` ends this payment: `outcome` is `ended`. After your server verifies the outcome, release the old order
  and offer a new checkout.
- A `null` client secret from `prepare` with `status: 'open'` leaves the payment
  `pending` with error code `access_ended`. The SDK keeps asking your endpoint
  until your server reports `completed` or `ended`.

Errors are `PaymentError`s with a `code`, a shopper-safe `message`, and
`submitted`, which is true when a charge may have been sent. Check `error.code`
rather than `instanceof`, because the hosted script has its own class.

Frame requests time out after 90 seconds without a reply or progress. Issuer
authentication gets up to 10 minutes. A timeout removes the old frame so it
cannot later submit a charge. If submission may have started, the payment stays
pending. `recover()` recreates a disconnected frame and checks the same payment;
it does not start another charge. Recreating the frame clears the card fields.

### Payment method selectors

Keep your selector and the single submit button in your own form. Put the card
frame inside the card option and hide it with `hidden` when another method is
selected; it keeps what the shopper typed. Lock the selector while
`snapshot.busy` is true or the state is `pending` or `action_required`. Lock the
order once your server has reserved it, including after a decline.

### Customize

`appearance.variables` themes the frame so the fields can match your own inputs.
Values are plain CSS values. Only the variables you set are sent; the others keep their defaults.
By default, `colorFocus` uses the merchant's effective checkout color from the Platform's Checkout settings.

| Variable | Styles |
| --- | --- |
| `colorText`, `colorPlaceholder` | Typed text and placeholders |
| `colorLabel`, `fontSizeLabel`, `fontWeightLabel` | Field labels |
| `colorTextSecondary` | Status messages |
| `colorBackground`, `colorBorder`, `borderRadius` | Field boxes |
| `colorDanger` | Invalid fields and error messages |
| `colorFocus` | Focus outline |
| `fontFamily`, `fontSizeBase` | Typed text. Below 16px, iOS zooms into a focused field |
| `fieldHeight`, `fieldPadding` | Field size and horizontal padding |
| `spacingLabel`, `spacing`, `spacingRow` | Label gap, gap between fields in a row, gap between rows |

Fonts from your page don't reach the frame, so use a system or generic font stack.
To follow a theme or breakpoint change without clearing the fields, call
`payment.update({ appearance })`. The React hook does this when `appearance`
changes. The provider applies `colorText`, `colorPlaceholder`, `fontFamily` and
`fontSizeBase` to the card number, expiry and CVC only when they mount, so later
changes to those four wait until the fields mount again. The cardholder field
keeps the same text styles as the secure fields.

`appearance.cardBrandIcon` places the detected card brand logo in the card number
field: `'left'` (default), `'right'` or `'none'`. The provider draws it at a fixed
32×24 px, so it can be moved or hidden but not resized. It applies when the fields
mount; `update()` does not change it, and the React hook remounts the fields when
it changes. Set it before the shopper starts typing.

`labels` translates the field labels and status messages. The provider's own
field placeholders are not translated.

### Content Security Policy

Your page only needs Tapaya's origin:

```
script-src https://js.tapaya.com
frame-src https://js.tapaya.com
```

The provider's scripts, the issuer challenge, and all payment API calls run inside
the frame under Tapaya's own policy. During 3-D Secure the frame temporarily covers the viewport. It uses the browser's
top layer (the Popover API), so it appears above your header, sticky elements and
any stacking context, and nothing on your page needs a z-index. Browsers without
the Popover API (before Chrome 114, Safari 17 and Firefox 125) fall back to
`position: fixed`; there, avoid mounting the frame inside an element with
`transform`, `filter` or `contain`.

## More information

- [Online Payments](https://docs.tapaya.com/online): overview and guides
- [API Integration](https://docs.tapaya.com/online/integration/api_integration): request fields, payment states, and
  idempotency rules
- [Checkout Security](https://docs.tapaya.com/online/security/checkout_security): key handling and payment
  verification
- Questions and feature requests: [developers@tapaya.com](mailto:developers@tapaya.com)

## License

[Apache-2.0](LICENSE)
