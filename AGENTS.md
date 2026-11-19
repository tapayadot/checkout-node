## Commit messages

- Use Conventional Commits: `type(scope): description`, with a short lowercase scope.
- Write a concise, imperative description without a trailing period.

## Changelog

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and is public. Every pull request into `main` must add an entry; the required `Changelog updated` check blocks the merge otherwise.

- Add entries under `## [Unreleased]`, below `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed` or `### Security`, in that order. Keep each entry on one `- ` line. Mark breaking changes with `**Breaking:**` and add an upgrade guide to the README.
- Write for package users. Inline code for methods, options and types is fine.
- Never leak anything internal. No partner or vendor names ("the processor", not the vendor), internal repositories or hosts, ticket IDs, PR numbers, commit hashes, repository file paths, keys or commit-style prefixes. `scripts/changelog/lint.mjs` blocks names by SHA-256 fingerprint (`BLOCKED_FINGERPRINTS`) so this public repository names none of them, and allows only the Tapaya hosts in `PUBLIC_HOSTS`. To block another name, add the output of `node scripts/changelog/cli.mjs --fingerprint "<name>"`; never write the name itself in the repository, a commit message or a pull request.
- For a change package users cannot notice, write one honest line: "Behind-the-scenes improvements to keep the package secure and reliable." Prefer a specific entry: if two PRs add the same line, the second one changes nothing in `CHANGELOG.md` once both merge, and its check fails.
- When you bump `package.json`, run `pnpm changelog:release` in the same pull request. It renames `[Unreleased]` to `## [x.y.z] - YYYY-MM-DD`, adds an empty `[Unreleased]` and fails if there are no entries. The `Release to npm` workflow refuses a version without entries.
- Exempt (the check passes with a note): release pull requests from `release/*` branches, Dependabot (author `dependabot[bot]`), and bot branches starting with `snyk-` or `renovate/`.
- Run `pnpm lint` before pushing.

## Pull requests

- Title: `type(scope): description`, with type one of feat, fix, docs, refactor, test, chore, perf, ci, build, revert, an optional `!`, a lowercase description and no final period. The required `PR title` check fails on other formats. Release pull requests and Dependabot are exempt.
- Fill in the Summary and Testing sections of `.github/pull_request_template.md`. A bot comment previews the `CHANGELOG.md` entries the pull request adds.
- Both `Changelog updated` and `PR title` must pass to merge into `main`.
