import assert from 'node:assert/strict'
import { test } from 'node:test'
import { releaseChangelog, releaseHasEntries } from './release.mjs'

const before = `# Changelog

Intro.

## [Unreleased]

### Added

- \`checkout.sessions.list()\`.

## [0.7.0] - 2026-11-17

### Fixed

- Older fix.
`

test('moves [Unreleased] into a dated release and adds an empty one on top', () => {
  const after = releaseChangelog(before, '0.8.0', '2026-12-01')
  assert.equal(after, before.replace('## [Unreleased]\n', '## [Unreleased]\n\n## [0.8.0] - 2026-12-01\n'))
  assert.ok(releaseHasEntries(after, '0.8.0'))
  assert.ok(!releaseHasEntries(after, '0.9.0'))
})

test('refuses an empty [Unreleased]', () => {
  const empty = before.replace(/## \[Unreleased\][\s\S]*?(?=## \[0\.7\.0\])/, '## [Unreleased]\n\n')
  assert.throws(() => releaseChangelog(empty, '0.8.0', '2026-12-01'), /no entries/)
})

test('refuses a version that already has a section', () => {
  assert.throws(() => releaseChangelog(before, '0.7.0', '2026-12-01'), /already has/)
})

test('refuses a file without [Unreleased]', () => {
  assert.throws(() => releaseChangelog('# Changelog\n', '0.8.0', '2026-12-01'), /no "## \[Unreleased\]"/)
})

test('refuses a result that fails the lint', () => {
  assert.throws(() => releaseChangelog(before.replace('`checkout.sessions.list()`', 'keys from internal.tapaya.com'), '0.8.0', '2026-12-01'), /CHANGELOG.md:\d+ "internal.tapaya.com"/)
})

test('a release section needs a date and an entry', () => {
  assert.ok(releaseHasEntries(before, '0.7.0'))
  assert.ok(!releaseHasEntries('# Changelog\n\n## [Unreleased]\n\n## [0.7.0] - 2026-11-17\n', '0.7.0'))
  assert.ok(!releaseHasEntries('# Changelog\n\n## [0.7.0]\n\n### Fixed\n\n- x\n', '0.7.0'))
})
