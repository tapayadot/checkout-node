// Pull request title rule and the PR exemptions shared by both checks. Pure.

import { COMMIT_TYPES } from './lint.mjs'

const TITLE = new RegExp(`^(${COMMIT_TYPES.join('|')})\\(([a-z0-9][a-z0-9-]*)\\)!?: (.+)$`)

/** Returns null for a valid title, or the reason it is invalid. */
export function titleProblem(title) {
  const match = title.match(TITLE)
  if (!match) return `Use "type(scope): description" with a lowercase type from: ${COMMIT_TYPES.join(', ')}, and a lowercase scope`
  const description = match[3]
  if (!/^[a-z0-9]/.test(description)) return 'Start the description with a lowercase letter'
  if (/[.\s]$/.test(description)) return 'Remove the final period or trailing space'
  return null
}

/**
 * Why a pull request skips the changelog and title checks, or null.
 * Release PRs come from release/* branches. Dependabot is matched by author;
 * other bots that a person opens are matched by branch prefix.
 */
export function exemption({ headRef = '', author = '' } = {}) {
  if (author === 'dependabot[bot]') return 'Dependabot pull requests are exempt'
  if (headRef.startsWith('release/')) return 'Release pull requests are exempt'
  if (/^(?:snyk-|renovate\/)/.test(headRef)) return 'Bot pull requests are exempt'
  return null
}
