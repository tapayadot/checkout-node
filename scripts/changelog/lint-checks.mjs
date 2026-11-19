import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { BLOCKED_FINGERPRINTS, blockedNames, fingerprint, lintChangelog, wordingProblems } from './lint.mjs'

const doc = (body) => `# Changelog\n\nIntro mentions \`code\` and \`/checkout/0.4.0/checkout.js\` freely.\n\n${body}`
const entry = (bullet) => doc(`## [Unreleased]\n\n### Added\n\n- ${bullet}\n`)
const messages = (text) => lintChangelog(text).map((p) => `${p.line} ${p.message}`).join('\n')

test('the repository changelog passes', () => {
  const text = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8')
  assert.deepEqual(lintChangelog(text), [])
})

test('a valid file with releases passes', () => {
  const text = doc(`## [Unreleased]

## [1.2.0] - 2026-01-31

### Added

- \`checkout.sessions.list()\` returns sessions page by page.

### Changed

- **Breaking:** \`tax\` is \`number | null\`.

### Fixed

- Webhook retries stop after a refund.
`)
  assert.deepEqual(lintChangelog(text), [])
})

test('release headings need a date and a valid shape', () => {
  assert.match(messages(doc('## [Unreleased]\n\n## [1.0.0]\n')), /^7 Release heading needs a date/m)
  assert.match(messages(doc('## [Unreleased]\n\n## 1.0.0 - 2026-01-01\n')), /^7 Release headings are/m)
  assert.match(messages(doc('## [Unreleased]\n\n## [1.0.0] - 2026-02-30\n')), /not a valid date/)
  assert.match(messages(doc('## [1.0.0] - 2026-01-01\n\n## [Unreleased]\n')), /must be the first release section/)
  assert.match(messages(doc('## [1.0.0] - 2026-01-01\n')), /Add a "## \[Unreleased\]" section/)
  assert.match(messages(doc('## [Unreleased]\n\n## [Unreleased]\n')), /appears more than once/)
})

test('sections are the Keep a Changelog ones, in order', () => {
  const out = messages(doc(`## [Unreleased]

### Fixed

- One.

### Added

- Two.

### Features

- Three.

#### Deep

- Bullets.

### Fixed

- Four.
`))
  assert.match(out, /^11 "Added" is out of order/m)
  assert.match(out, /^15 "###" headings are only Added, Changed, Deprecated, Removed, Fixed, Security/m)
  assert.match(out, /^17 Bullets must sit under one of/m)
  assert.match(out, /^19 Use only "##" and "###" headings/m)
  assert.match(out, /^23 "Fixed" is out of order or repeated/m)
})

test('empty sections, loose text and bullets outside sections are reported', () => {
  const out = messages(doc('## [Unreleased]\n\n- Orphan.\n\n### Added\n\n### Fixed\n\n- One.\n  continued\n* Star.\n'))
  assert.match(out, /^7 Bullets must sit under one of/m)
  assert.match(out, /^9 "Added" has no entries/m)
  assert.match(out, /^14 Only headings and "- " bullets/m)
  assert.match(out, /^15 Only headings and "- " bullets/m)
})

test('the intro is free-form but cannot leak', () => {
  assert.deepEqual(lintChangelog(doc('## [Unreleased]\n')), [])
  const leaky = '# Changelog\n\nTested on internal.tapaya.com with pk_dev_abc123def.\nTracks DEV-781 (#12) from 3385733 in src/index.ts.\n\n### fix(checkout): update payments\n\n- feat(sdk): add a thing\n\n   ### fix(checkout): indented heading\n\n> 1) chore(repo): quoted list\n\n> 1) ### fix(checkout): nested heading\n\n- > ## docs(readme): nested quote\n\n## [Unreleased]\n'
  const out = messages(leaky)
  assert.match(out, /^3 "internal\.tapaya\.com" is not a public Tapaya host/m)
  assert.match(out, /^3 Remove keys/m)
  for (const pattern of [/^4 Remove internal ticket IDs/m, /^4 Remove pull request/m, /^4 Remove commit hashes/m, /^4 Remove repository file paths/m, /^6 Remove the commit-style prefix/m, /^8 Remove the commit-style prefix/m, /^10 Remove the commit-style prefix/m, /^12 Remove the commit-style prefix/m, /^14 Remove the commit-style prefix/m, /^16 Remove the commit-style prefix/m]) assert.match(out, pattern)
})

test('developer wording passes', () => {
  for (const text of [
    'Set `privacyNotice: \'merchant\'` to hide the notice.',
    'Requires Node.js 22.13 and React 18 or newer; TypeScript types follow.',
    'Use `/checkout/0.4.0/checkout.js` and hashes from `0.4.0/manifest.json`.',
    'Import from `@tapayadot/checkout/client`.',
    'A `tapaya_live_` key selects `https://api.tapaya.com`; `https://api.sandbox.tapaya.com` stays for tests.',
    'Shoppers can pay with Apple Pay and Google Pay.',
    'The defaced and accepted cards are fine.',
  ]) {
    assert.deepEqual(wordingProblems(text), [], text)
  }
})

test('blocked names are matched by fingerprint, so no name is written down', () => {
  // A made-up partner: the real list holds only fingerprints.
  const made_up = new Set([fingerprint('acme-pay'), fingerprint('globex bank')])
  assert.deepEqual(blockedNames('Accept live Acme-Pay keys.', made_up), ['Acme-Pay'])
  assert.deepEqual(blockedNames('Signed through Globex Bank today.', made_up), ['Globex Bank'])
  assert.deepEqual(blockedNames('Keys from acme-pay.example work.', made_up), ['acme-pay'])
  assert.deepEqual(blockedNames('Acme payments and a global bank pass.', made_up), [])
})

test('the blocklist holds only fingerprints, and common words are not on it', () => {
  assert.ok(BLOCKED_FINGERPRINTS.size > 0)
  for (const entry of BLOCKED_FINGERPRINTS) assert.match(entry, /^[0-9a-f]{64}$/)
  assert.deepEqual(blockedNames('Resend the email, prepare the payment, and approve the shipping quote.'), [])
})

test('only public Tapaya hosts pass', () => {
  assert.deepEqual(wordingProblems('Use `https://api.tapaya.com`, `https://api.sandbox.tapaya.com`, js.tapaya.com and docs.tapaya.com.'), [])
  assert.match(wordingProblems('Test on api.staging.tapaya.com first.').join(), /"api\.staging\.tapaya\.com" is not a public Tapaya host/)
})

test('repository paths, numbers, hashes, prefixes, tickets and keys fail', () => {
  const cases = {
    'Changed `src/client/types.ts`.': /repository file paths/,
    'Needs `070_checkout_shipping_quotes.sql`.': /repository file paths/,
    'Fixes a crash (#123).': /pull request and issue numbers/,
    'Reverts 3385733.': /commit hashes/,
    'feat(checkout): add a thing.': /commit-style prefix/,
    'Needs DEV-781 first.': /ticket IDs/,
    'Use tapaya_test_abc123def to try it.': /Remove keys/,
    'Use pk_dev_abc123def locally.': /Remove keys/,
    'Fixes `#123`.': /pull request and issue numbers/,
    'See [the fix](https://github.com/tapayadot/checkout-node/pull/12).': /commit links/,
    'See [code](./src/client/index.js).': /repository file paths/,
    '**Breaking:** feat(checkout): drop retrieve.': /commit-style prefix/,
  }
  for (const [text, pattern] of Object.entries(cases)) assert.match(wordingProblems(text).join(), pattern, text)
})

test('problems carry the file line', () => {
  assert.deepEqual(lintChangelog(entry('Calls internal.tapaya.com.')), [{ line: 9, message: '"internal.tapaya.com" is not a public Tapaya host; leave it out of the public changelog' }])
})
