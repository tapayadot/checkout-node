# Changelog

All notable changes to `@tapayadot/checkout` are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, a minor version can include breaking changes; they are marked **Breaking**. The README has upgrade guides for each of them.

## [Unreleased]

### Fixed

- The `declinedLimitExceeded` and `declinedInsufficientFunds` label docs now say that Tapaya's own message wins over a generic `declined` label, unless Tapaya has no copy for the requested `locale`.

## [0.7.0] - 2026-11-17

### Added

- `privacyNotice` option. The card fields show a notice that Tapaya processes the payment, with a link to Tapaya's privacy policy; `privacyNotice: 'merchant'` hides it.
- The card fields render the email and phone inputs that `customerCollection` requests and you did not supply. A wallet fills them when it returns a contact.
- Optional labels `cardholderPlaceholder`, `declinedLimitExceeded` and `declinedInsufficientFunds`, labels and errors for the contact fields, and `declineReason` on declined results.

### Changed

- Hosted sessions no longer require a contact, and `customer` is optional. Without an email or phone, hosted checkout asks the shopper for one before payment.
- The browser loader loads Tapaya.js `0.4.0` and refuses older releases.
- `checkout.sessions.prepare()` sends changed contact details to an embedded payment that has not been submitted yet.

## [0.6.0] - 2026-11-06

### Changed

- **Breaking:** Hosted session creation requires `customer.email` or `customer.phone`. `HostedCheckoutCustomer` requires one in TypeScript, and a missing contact throws `TapayaValidationError` before the request is sent.

## [0.5.0] - 2026-11-02

### Changed

- Items can omit `imageUrl` or send `null`. Sessions return items as `CheckoutSessionItem`, with `imageUrl: string | null`.

## [0.4.0] - 2026-10-29

### Added

- Save cards and charge them later, in hosted and embedded checkout.
- Manual capture holds the amount without charging it, and `PaymentStatus` includes `authorized`.
- Shipping quotes, with fixed delivery options or dynamic quotes that your server approves.
- `customerCollection` chooses wallet contact collection and name or billing fields. Payment reads keep the returned `customer` details.
- `PaymentError` and `snapshot.error` can include `details`.

### Changed

- **Breaking:** Payment errors use specific codes instead of `validation` and `wallet`, such as `card_invalid` or `wallet_session_ended`. A rejected wallet tokenization or 3DS check reports `tokenization` or `authentication` instead of `frame`.
- **Breaking:** Hosted session `tax` and `shipping` are `number | null`. They are `null` when the session was created without them, instead of `0`.
- The browser loader loads Tapaya.js `0.3.0` and rejects older scripts.
- Updated `zod` to 4.6.7.

### Deprecated

- `checkout.sessions.retrieve()`. Use `get()`, which every resource uses.

## [0.3.0] - 2026-10-19

### Added

- Apple Pay and Google Pay in embedded checkout, with click callbacks and React updates for totals and payment methods.
- Live publishable keys, so embedded checkout runs in production.

### Changed

- `environment: 'production'` runs embedded checkout against `https://api.tapaya.com` instead of throwing, and `configuration()` returns `environment: 'production'` with live keys.
- Without `environment` or `TAPAYA_ENVIRONMENT`, a `tapaya_live_` key selects production. A key that does not match the selected environment throws when the client is created, instead of failing each request.
- The browser loader loads Tapaya.js `0.2.0`.

## [0.2.0] - 2026-10-07

### Added

- Embedded checkout: create embedded sessions, render card fields in the browser with `@tapayadot/checkout/client`, and use the React hook from `@tapayadot/checkout/react`.
- Act for a selected merchant with an organization secret key.

### Changed

- **Breaking:** Hosted session creation requires `merchantOrderId`, with non-whitespace text of at most 200 characters.
- **Breaking:** Hosted idempotency keys are limited to 250 characters instead of 255.
- **Breaking:** `CheckoutSession` is a union of `HostedCheckoutSession` and `EmbeddedCheckoutSession`, and hosted responses include `mode: 'hosted'`.

## [0.1.1] - 2026-10-01

### Changed

- **Breaking:** `checkout.sessions.retrieve()` is renamed to `checkout.sessions.get()`.
- Package links point to the `tapayadot/checkout-node` repository.

## [0.1.0] - 2026-10-01

### Added

- Server client for hosted checkout: create sessions with `tapaya.checkout.sessions.create()` and read them with `tapaya.checkout.sessions.retrieve()`.
- Idempotency keys for safe retries, and typed errors for failed requests.
