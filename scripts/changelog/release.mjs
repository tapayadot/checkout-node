// Moves [Unreleased] entries into a dated release section. Pure.

import { formatProblems, lintChangelog } from './lint.mjs'

/** Lines of the section whose heading starts with `heading`, or null. */
function sectionLines(lines, heading) {
  const start = lines.findIndex((line) => line.startsWith(heading))
  if (start === -1) return null
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  return lines.slice(start + 1, end === -1 ? lines.length : end)
}

/** Whether CHANGELOG.md has a dated `## [version]` section with at least one entry. */
export function releaseHasEntries(text, version) {
  const section = sectionLines(text.split('\n'), `## [${version}] - `)
  return Boolean(section?.some((line) => line.startsWith('- ')))
}

/** Returns the new CHANGELOG.md text, or throws with the reason. */
export function releaseChangelog(text, version, date) {
  const lines = text.split('\n')
  const start = lines.indexOf('## [Unreleased]')
  if (start === -1) throw new Error('CHANGELOG.md has no "## [Unreleased]" section')
  if (lines.some((line) => line.startsWith(`## [${version}]`))) throw new Error(`CHANGELOG.md already has a "## [${version}]" section`)
  if (!sectionLines(lines, '## [Unreleased]').some((line) => line.startsWith('- '))) {
    throw new Error('"## [Unreleased]" has no entries to release')
  }

  lines.splice(start, 1, '## [Unreleased]', '', `## [${version}] - ${date}`)
  const result = lines.join('\n')
  const problems = lintChangelog(result)
  if (problems.length) throw new Error(formatProblems(problems))
  return result
}
