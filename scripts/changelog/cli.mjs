#!/usr/bin/env node
// Usage:
//   node scripts/changelog/cli.mjs                         lint CHANGELOG.md
//   node scripts/changelog/cli.mjs --base origin/main      lint, and require a CHANGELOG.md update
//   node scripts/changelog/cli.mjs --render-comment --base origin/main
//   node scripts/changelog/cli.mjs --check-title "<title>"
//   node scripts/changelog/cli.mjs --release [--date YYYY-MM-DD]
//   node scripts/changelog/cli.mjs --check-release         lint, and require entries for the package.json version
//   node scripts/changelog/cli.mjs --fingerprint "<name>"   print the fingerprint to block a name
// --head-ref and --author apply the pull request exemptions.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { renderComment } from './comment.mjs'
import { fingerprint, formatProblems, lintChangelog } from './lint.mjs'
import { releaseChangelog, releaseHasEntries } from './release.mjs'
import { exemption, titleProblem } from './title.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHANGELOG = 'CHANGELOG.md'
const MANIFEST = 'package.json'

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    'render-comment': { type: 'boolean' },
    'check-title': { type: 'string' },
    release: { type: 'boolean' },
    'check-release': { type: 'boolean' },
    fingerprint: { type: 'string' },
    date: { type: 'string' },
    'head-ref': { type: 'string' },
    author: { type: 'string' },
  },
})

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const read = (file) => readFileSync(join(ROOT, file), 'utf8')
const fail = (message) => {
  console.error(message)
  process.exit(1)
}
const exempt = exemption({ headRef: values['head-ref'], author: values.author })
const missingRelease = (version) =>
  `package.json is now ${version}. Run "pnpm changelog:release" to move the [Unreleased] entries into "## [${version}] - YYYY-MM-DD".`

if (values.fingerprint !== undefined) {
  console.log(fingerprint(values.fingerprint))
  process.exit(0)
}

if (values['check-title'] !== undefined) {
  if (exempt) {
    console.log(`${exempt}; skipping the title check.`)
  } else {
    const problem = titleProblem(values['check-title'])
    if (problem) fail(`Invalid pull request title "${values['check-title']}": ${problem}.`)
    console.log('Pull request title is valid.')
  }
  process.exit(0)
}

if (values.release) {
  const version = JSON.parse(read(MANIFEST)).version
  const date = values.date ?? new Date().toISOString().slice(0, 10)
  try {
    writeFileSync(join(ROOT, CHANGELOG), releaseChangelog(read(CHANGELOG), version, date))
  } catch (error) {
    fail(error.message)
  }
  console.log(`Moved [Unreleased] to [${version}] - ${date}.`)
  process.exit(0)
}

if (values['render-comment']) {
  if (!values.base) fail('--render-comment needs --base <ref>')
  // Exempt pull requests get no comment; an empty output skips the comment job.
  if (!exempt) process.stdout.write(renderComment(read(CHANGELOG), git('diff', '-U0', `${values.base}...HEAD`, '--', CHANGELOG)))
  process.exit(0)
}

const problems = lintChangelog(read(CHANGELOG))
if (problems.length) fail(formatProblems(problems))

if (values['check-release']) {
  const version = JSON.parse(read(MANIFEST)).version
  if (!releaseHasEntries(read(CHANGELOG), version)) fail(missingRelease(version))
}

if (values.base) {
  if (exempt) {
    console.log(`${exempt}; CHANGELOG.md does not need an update.`)
    process.exit(0)
  }
  const changed = git('diff', '--name-only', `${values.base}...HEAD`).split('\n')
  if (!changed.includes(CHANGELOG)) {
    fail('CHANGELOG.md is not updated. Add an entry under "## [Unreleased]" that tells package users what changed.')
  }
  const version = JSON.parse(read(MANIFEST)).version
  let baseVersion = null
  try {
    baseVersion = JSON.parse(git('show', `${values.base}:${MANIFEST}`)).version
  } catch {
    // The manifest is new on this branch.
  }
  if (version !== baseVersion && !releaseHasEntries(read(CHANGELOG), version)) fail(missingRelease(version))
}
console.log('CHANGELOG.md is valid.')
