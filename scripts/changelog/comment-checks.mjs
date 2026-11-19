import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addedLineNumbers, escapeText, MARKER, MAX_COMMENT_LENGTH, renderComment } from './comment.mjs'

const changelog = `# Changelog

Intro.

## [Unreleased]

### Added

- Old entry.
- \`checkout.sessions.list()\`.

### Fixed

- Webhook <b>retries</b> & @team pings.

### Features

- Not a section.

## [1.0.0] - 2026-01-01

### Added

- Released entry.
`

test('collects added line numbers from a zero-context diff', () => {
  const diff = `diff --git a/CHANGELOG.md b/CHANGELOG.md
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -10,0 +11 @@
+- One.
@@ -14 +15,2 @@
-- Old.
+- Two.
+
@@ -20,0 +23 @@
+- Three.`
  assert.deepEqual([...addedLineNumbers(diff)], [11, 15, 16, 23])
})

test('renders only added bullets under valid headings, grouped and escaped', () => {
  const diff = '@@ -9,0 +10 @@\n+- `checkout.sessions.list()`.\n@@ -13 +14 @@\n-- Old.\n+- Webhook <b>retries</b> & @team pings.\n@@ -17,0 +18,2 @@\n+\n+- Not a section.'
  assert.equal(renderComment(changelog, diff), `${MARKER}
### Changelog preview

This pull request adds these entries to CHANGELOG.md:

#### Unreleased

_Added_

- \`checkout.sessions.list()\`.

_Fixed_

- Webhook &lt;b&gt;retries&lt;/b&gt; &amp; @&#8203;team pings.
`)
})

test('asks for entries when none were added', () => {
  const body = renderComment(changelog, '')
  assert.ok(body.startsWith(MARKER))
  assert.match(body, /adds no entries to CHANGELOG.md/)
})

test('escapes HTML and mentions', () => {
  assert.equal(escapeText('<script>&@x'), '&lt;script&gt;&amp;@&#8203;x')
})

test('caps the comment length', () => {
  const bullets = Array.from({ length: 2000 }, (_, i) => `- Entry number ${i} with enough words to fill the comment quickly.`)
  const text = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n${bullets.join('\n')}\n`
  const diff = `@@ -0,0 +7,2000 @@\n${bullets.map((b) => `+${b}`).join('\n')}`
  const body = renderComment(text, diff)
  assert.ok(body.length < MAX_COMMENT_LENGTH + 200)
  assert.match(body, /Preview cut short/)
})
