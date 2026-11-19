// Builds the pull request comment that previews added CHANGELOG.md entries. Pure.

import { SECTIONS } from './lint.mjs'

export const MARKER = '<!-- changelog-preview -->'
// GitHub rejects comments over 65,536 characters.
export const MAX_COMMENT_LENGTH = 60000

/** Line numbers (1-based, in the new file) that a `git diff -U0` adds. */
export function addedLineNumbers(diff) {
  const added = new Set()
  let next = null
  for (const line of diff.split('\n')) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      next = Number(hunk[1])
      continue
    }
    if (next === null || line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added.add(next++)
    else if (line.startsWith(' ')) next++
  }
  return added
}

export function escapeText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/@/g, '@&#8203;')
}

/** Added bullets under a valid release and section heading, in file order. */
export function addedEntries(changelog, added) {
  const entries = []
  let release = null
  let section = null
  changelog.split('\n').forEach((raw, index) => {
    const text = raw.trimEnd()
    const releaseMatch = text.match(/^## \[(Unreleased|\d+\.\d+\.\d+)\]/)
    if (releaseMatch) {
      release = releaseMatch[1]
      section = null
    } else if (text.startsWith('### ')) {
      section = SECTIONS.includes(text.slice(4)) ? text.slice(4) : null
    } else if (/^#{1,2} /.test(text)) {
      release = section = null
    } else if (release && section && /^- \S/.test(text) && added.has(index + 1)) {
      entries.push({ release, section, text: text.slice(2) })
    }
  })
  return entries
}

/** Markdown body for the preview comment, starting with the hidden marker. */
export function renderComment(changelog, diff) {
  const entries = addedEntries(changelog, addedLineNumbers(diff))
  const header = `${MARKER}\n### Changelog preview\n\n`
  if (entries.length === 0) {
    return `${header}This pull request adds no entries to CHANGELOG.md. Add at least one bullet under "## [Unreleased]", below one of: ${SECTIONS.join(', ')}.\n`
  }
  let body = `${header}This pull request adds these entries to CHANGELOG.md:\n`
  let last = {}
  for (const entry of entries) {
    if (entry.release !== last.release) body += `\n#### ${entry.release}\n`
    if (entry.release !== last.release || entry.section !== last.section) body += `\n_${entry.section}_\n\n`
    body += `- ${escapeText(entry.text)}\n`
    last = entry
  }
  if (body.length > MAX_COMMENT_LENGTH) {
    body = `${body.slice(0, body.lastIndexOf('\n', MAX_COMMENT_LENGTH))}\n\n_Preview cut short. See CHANGELOG.md in the diff for the rest._\n`
  }
  return body
}
