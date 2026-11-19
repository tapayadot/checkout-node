import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exemption, titleProblem } from './title.mjs'

test('accepts the repository title format', () => {
  for (const title of [
    'feat(checkout): release 0.7.0 with optional hosted contacts and Tapaya.js 0.4.0',
    'chore(release): prepare version 0.2.0',
    'chore(release): release 0.6.0',
    'feat(checkout): make item imageUrl optional',
    'refactor(checkout): rename retrieve to get',
    'docs(readme): refresh README layout and branding',
    'fix(ci): run workflow on main',
    'feat(checkout)!: require a contact for hosted sessions',
  ]) {
    assert.equal(titleProblem(title), null, title)
  }
})

test('rejects other formats', () => {
  for (const title of [
    '[Snyk] Upgrade zod from 4.6.5 to 4.6.7',
    'Develop',
    'Merge pull request #18 from tapayadot/feat/checkout-0.7.0',
    'Bump zod from 4.6.5 to 4.6.7',
    'feat: add a thing',
    'Feat(checkout): add a thing',
    'feat(Checkout): add a thing',
    'feat(checkout): Add a thing',
    'feat(checkout): add a thing.',
  ]) {
    assert.notEqual(titleProblem(title), null, title)
  }
})

test('exempts release pull requests and bots', () => {
  assert.match(exemption({ headRef: 'release/0.8.0' }), /Release/)
  assert.match(exemption({ author: 'dependabot[bot]', headRef: 'dependabot/npm_and_yarn/zod-4.6.7' }), /Dependabot/)
  assert.match(exemption({ headRef: 'snyk-upgrade-123', author: 'someone' }), /Bot/)
  assert.equal(exemption({ headRef: 'chore/release-0.8.0', author: 'someone' }), null)
  assert.equal(exemption(), null)
})
