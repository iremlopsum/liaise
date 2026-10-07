// Prints the GitHub Release notes for one version: its CHANGELOG.md section
// without the heading, with repo-relative links made absolute — a release page
// has no "current directory", so ./MIGRATION.md#… would 404 there.
//
// Usage: node scripts/release-notes.mjs <version> [--changelog CHANGELOG.md]
import { readFileSync } from 'node:fs'
import { sectionBody } from './changelog.mjs'

const REPO_FILES = 'https://github.com/iremlopsum/liaise/blob/main/'

const args = process.argv.slice(2)
const version = args[0]
const at = args.indexOf('--changelog')
const changelogPath = at === -1 ? 'CHANGELOG.md' : args[at + 1]

if (!version || version.startsWith('--')) {
  console.error('usage: node scripts/release-notes.mjs <version> [--changelog CHANGELOG.md]')
  process.exit(2)
}

const body = sectionBody(readFileSync(changelogPath, 'utf8'), version)
if (body === null) {
  console.error(`release-notes: CHANGELOG has no "## [${version}]" section`)
  process.exit(1)
}

// Relative = not a scheme (https:, mailto:), not an in-page #anchor, not root-absolute.
const absolute = body.replace(/\]\((?![a-z][a-z0-9+.-]*:|#|\/)(?:\.\/)?([^)\s]+)\)/gi, `](${REPO_FILES}$1)`)
process.stdout.write(absolute)
