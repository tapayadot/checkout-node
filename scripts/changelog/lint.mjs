// Checks CHANGELOG.md structure, and that public entries leak nothing internal.
// Pure: text in, problems out. The format follows https://keepachangelog.com/en/1.1.0/.

import { createHash } from 'node:crypto'

export const SECTIONS = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']
export const COMMIT_TYPES = ['feat', 'fix', 'docs', 'refactor', 'test', 'chore', 'perf', 'ci', 'build', 'revert']

// SHA-256 fingerprints of lowercase partner names and internal repository names.
// This file is public, so it names none of them. Add a name with
// `node scripts/changelog/cli.mjs --fingerprint "<name>"`; never commit the name itself.
// Entries say "the processor", "e-signature", and so on.
export const BLOCKED_FINGERPRINTS = new Set([
  'f29ec32ce8a81b4a45fceed1702a0af4d55d6d847fcc15ae3c2efed9482b355a',
  '2bed2032ed3d8300b7714ff77101e6c43637597977337c699191dd844c86a72d',
  'ee46e2d141d53f08cc6dc5102319ddb97817480ce931d2b6381bf7ccca94bed0',
  '7c620baa773530eb6305b7fa18ba0558a60e7d79d91b46f76b8b8d0c534cbe19',
  '8b466428f39d3a25b894b6639d7acfd4b4f5a4e4284cc78bc740c21b48ab566f',
  'e2d67f41fee239d12faf598242412e25b357740b9a20a5b14c9795dcae320bf5',
  'afe4d16f403a383f07814bbe04a5e7c5a7dc62ba5ce4040fc85514c29e0e88ae',
  '3a7f607fe0dd14957760547d9fed84da46e3196823af728d3d5bca78a49162e6',
  '24415532349ddf70d3550bba448ed17c6faa8b74933206b562a15488f38162ee',
  '89d01c9ba73cb5c4fbd849c699875ddbb1fd302cadaf1cee4552e92e73676835',
  '40a9f85ef6a367cac72c696e671b891d3a8d4a201c279eece5c706a5e7f4c629',
  '9f4d422f361728816036982f11cb1d0b12d3d0e6cb4b9e30748e6ba47263d47c',
  '0cf6855c1a3c323bfb9d788f7a55f0ce6cc765b2922c247c28ea21babf00c919',
  '67e5a3025bc013d09e3a1e6659f2e53efc7d137272ffe72b6dc8344f578461cf',
  '9c4548a7c5a503fdde8260b6e06045489226867d7a22907ccf248156ad6a79dd',
  '109ec9640cdf3d1c40e425e72f33f1ceff4e82298d3eb382bb8ecf182ec009a2',
  'c16c6caa6440a2ebf8cec93f6c0f402c4d923cac57bbb1bf2ad290f642ecf036',
  '9bd4b0385af187a0bfffc0574f237e2cd9b9e77c5501d578e497151736542f32',
  '1587a84ef96686b94ffbd7b23806ecc16c2a0adafda933721a6ae1091a9c24a6',
  '6c445be1311e401801379166e97f8fe458e0e9d16a2af8350ca13fb602c8faa2',
  'cf34719b78f6f5030d0534235d5c3c2cef401fe6990291ec687b626227e9037a',
])

// Tapaya hosts the public docs already name. Any other *.tapaya.com host is internal.
export const PUBLIC_HOSTS = ['tapaya.com', 'www.tapaya.com', 'api.tapaya.com', 'api.sandbox.tapaya.com', 'checkout.tapaya.com', 'checkout.sandbox.tapaya.com', 'js.tapaya.com', 'docs.tapaya.com']

export const fingerprint = (name) => createHash('sha256').update(name.toLowerCase()).digest('hex')

/** Words and two-word phrases in `text` whose fingerprint is in `fingerprints`. */
export function blockedNames(text, fingerprints = BLOCKED_FINGERPRINTS) {
  const words = text.match(/[\p{L}\p{N}](?:[\p{L}\p{N}.-]*[\p{L}\p{N}])?/gu) ?? []
  const candidates = new Set()
  words.forEach((word, index) => {
    candidates.add(word)
    for (const part of word.split('.')) {
      candidates.add(part)
      for (const piece of part.split('-')) candidates.add(piece)
    }
    if (index > 0) candidates.add(`${words[index - 1]} ${word}`)
  })
  return [...candidates].filter((candidate) => fingerprints.has(fingerprint(candidate)))
}

// Any run of quote, list and heading markers, removed so intro text is checked like an entry.
const INTRO_MARKER = /^(?:\s*(?:>|#+|[-*+](?=\s)|\d+[.)](?=\s)))*\s*/
const RELEASE = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/

// Inline code is fine: readers are developers. Public CDN files such as
// `/checkout/0.4.0/checkout.js` are fine too; source and migration files are not.
// Checked everywhere, including the intro: nothing in this file may leak.
const SECRETS = [
  [/\b(?:tapaya|pk|sk)_(?:live|test|dev)_[A-Za-z0-9]{6,}/, 'Remove keys; name the key prefix only'],
]

const PATTERNS = [
  [/(?:^|[\s(`\[])(?:\.{1,2}\/)?(?:src|scripts|test|tests|db|migrations|\.github)\/|\b[\w-]+\.(?:tsx?|mts|cts|mjs|cjs|sql|ya?ml|env)\b/i, 'Remove repository file paths'],
  [/(?:^|[\s(`\[])#\d+\b|github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues|commit)\//, 'Remove pull request and issue numbers, and commit links'],
  [/(?<![\w-])(?=[0-9a-f]*\d)[0-9a-f]{7,40}(?![\w-])/i, 'Remove commit hashes'],
  [new RegExp(`^(?:\\*\\*Breaking:\\*\\* )?(?:${COMMIT_TYPES.join('|')})(?:\\([^)]*\\))?!?:`, 'i'), 'Remove the commit-style prefix; describe the change for package users'],
  [/\b[A-Z][A-Z0-9]{1,9}-\d+\b/, 'Remove internal ticket IDs'],
]

function validDate(value) {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Partner and internal names, internal hosts and keys in any line, as messages. */
export function leakProblems(text) {
  const problems = []
  for (const name of blockedNames(text)) problems.push(`"${name}" is a partner or internal name; leave it out of the public changelog`)
  for (const [, host] of text.matchAll(/\b((?:[\w-]+\.)*tapaya\.com)\b/gi)) {
    if (!PUBLIC_HOSTS.includes(host.toLowerCase())) problems.push(`"${host}" is not a public Tapaya host; leave it out of the public changelog`)
  }
  for (const [regex, message] of SECRETS) if (regex.test(text)) problems.push(message)
  return problems
}

/** Problems in a bullet's text, as messages. */
export function wordingProblems(text) {
  const problems = leakProblems(text)
  for (const [regex, message] of PATTERNS) if (regex.test(text)) problems.push(message)
  return problems
}

/**
 * Lints CHANGELOG.md text. Returns [{ line, message }] with 1-based lines.
 * The intro is free-form prose, but it gets the same leak checks as entries.
 */
export function lintChangelog(text) {
  const problems = []
  const report = (line, message) => problems.push({ line, message })
  const lines = text.split('\n')
  const versions = new Set()
  let inRelease = false
  let releases = 0
  let section = null
  let lastSection = -1
  let pending = null // a section heading still waiting for a bullet

  const closeSection = () => {
    if (pending) report(pending.line, `"${pending.name}" has no entries; remove the heading`)
    pending = null
  }

  if (lines[0] !== '# Changelog') report(1, 'The first line must be "# Changelog"')

  lines.forEach((raw, index) => {
    const line = index + 1
    const text = raw.trimEnd()
    if (index === 0 || text === '') return

    if (/^#+(?:\s|$)/.test(text)) {
      const level = text.match(/^#+/)[0].length
      if (level === 1) return report(line, 'Only the first line may be a "#" heading')
      if (level === 2) {
        closeSection()
        section = null
        lastSection = -1
        const unreleased = text === '## [Unreleased]'
        const match = text.match(RELEASE)
        if (!unreleased && !match) {
          if (/^## \[\d+\.\d+\.\d+\]\s*$/.test(text)) report(line, 'Release heading needs a date: "## [x.y.z] - YYYY-MM-DD"')
          else report(line, 'Release headings are "## [Unreleased]" or "## [x.y.z] - YYYY-MM-DD"')
        } else if (unreleased && releases > 0) {
          report(line, '"## [Unreleased]" must be the first release section')
        } else if (match && !validDate(match[2])) {
          report(line, `"${match[2]}" is not a valid date`)
        }
        const key = unreleased ? 'Unreleased' : match?.[1]
        if (key && versions.has(key)) report(line, `"${key}" appears more than once`)
        if (key) versions.add(key)
        releases += 1
        inRelease = true
        return
      }
      if (!inRelease) {
        for (const message of wordingProblems(text.replace(INTRO_MARKER, ''))) report(line, message)
        return
      }
      if (level === 3) {
        closeSection()
        const name = text.slice(4)
        const position = SECTIONS.indexOf(name)
        if (position === -1) {
          section = null
          return report(line, `"###" headings are only ${SECTIONS.join(', ')}`)
        }
        if (position <= lastSection) report(line, `"${name}" is out of order or repeated; use ${SECTIONS.join(', ')}`)
        lastSection = Math.max(lastSection, position)
        section = name
        pending = { line, name }
        return
      }
      return report(line, 'Use only "##" and "###" headings')
    }

    if (!inRelease) {
      for (const message of wordingProblems(text.replace(INTRO_MARKER, ''))) report(line, message)
      return
    }

    if (!/^- \S/.test(text)) {
      return report(line, 'Only headings and "- " bullets belong in release sections; keep each entry on one line')
    }
    if (!section) return report(line, `Bullets must sit under one of: ${SECTIONS.join(', ')}`)
    pending = null
    for (const message of wordingProblems(text.slice(2))) report(line, message)
  })
  closeSection()

  if (!versions.has('Unreleased')) report(lines.length, 'Add a "## [Unreleased]" section above the releases')
  return problems
}

export function formatProblems(problems, file = 'CHANGELOG.md') {
  return problems.map(({ line, message }) => `${file}:${line} ${message}`).join('\n')
}
