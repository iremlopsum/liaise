// Decides what the release workflow must do for the version in package.json,
// and refuses a release that would ship broken notes or the wrong version.
// Spec: docs/superpowers/specs/2026-10-07-release-pipeline-design.md §3–4.
//
//   --mode push     a push to main: publish when npm lacks the version; release
//                   (tag + GitHub Release) when either is missing — the repair
//                   path re-runs only what an earlier run did not finish
//   --mode pr       a pull request: check only, and only if it bumps the version
//   --mode dry-run  check as if publishing, whatever npm already has; never release
//
// stdout: key=value lines for $GITHUB_OUTPUT. stderr: messages for people.
// Exit 0 = decided, 1 = refused (every problem listed), 2 = bad usage.
// Tests inject the network answers with --npm-versions / --tags / --releases /
// --npm-githead (or 'none') / --target; without them the real sources are asked.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { headings, footerFor, sectionBody } from './changelog.mjs'

const REPO = 'https://github.com/iremlopsum/liaise'

const args = process.argv.slice(2)
const flag = name => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}
const mode = flag('mode')
const root = flag('root') ?? '.'
if (!['push', 'pr', 'dry-run'].includes(mode)) usage('--mode must be push, pr or dry-run')
if (mode === 'pr' && flag('base-version') === undefined) usage('--mode pr needs --base-version')

function usage(message) {
  console.error(`release-check: ${message}`)
  console.error('usage: node scripts/release-check.mjs --mode <push|pr|dry-run> [--root DIR] [--base-version X]')
  process.exit(2)
}

const sh = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const lines = text => text.split('\n').map(s => s.trim()).filter(Boolean)
const injected = name => (flag(name) === undefined ? undefined : JSON.parse(flag(name)))

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
const version = pkg.version

function npmVersions() {
  const given = injected('npm-versions')
  if (given) return given
  try {
    const out = JSON.parse(sh('npm', ['view', pkg.name, 'versions', '--json']))
    return Array.isArray(out) ? out : [out]
  } catch (e) {
    if (/E404/.test(String(e.stderr))) return [] // never published
    throw e
  }
}
const tags = () => injected('tags') ?? lines(sh('git', ['tag', '--list', 'v*']))
const releases = () => injected('releases') ?? lines(sh('gh', ['release', 'list', '--limit', '1000', '--json', 'tagName', '--jq', '.[].tagName']))

// --- semver, stable versions only ---------------------------------------------
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
const parse = v => { const m = SEMVER.exec(v); return m && { nums: [+m[1], +m[2], +m[3]], pre: m[4] } }
const compare = (a, b) => { const x = parse(a).nums, y = parse(b).nums; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0 }
const stable = list => list.filter(v => parse(v) && !parse(v).pre)
const newest = list => stable(list).sort(compare).pop()

// --- checks -------------------------------------------------------------------
function problemsFor({ requireNewer, npm, tagList }) {
  const problems = []
  const parsed = parse(version)
  if (!parsed) return [`package.json version "${version}" is not semver`]
  if (parsed.pre) problems.push(`${version} is a prerelease; prereleases are out of scope for the pipeline (spec §9)`)

  if (requireNewer) {
    const top = newest(npm)
    if (npm.includes(version)) problems.push(`npm already has ${version}`)
    else if (top && compare(version, top) <= 0) problems.push(`${version} is not newer than ${top}, the newest version on npm`)
    if (tagList.includes(`v${version}`)) problems.push(`tag v${version} already exists but npm does not have ${version}; it may point at another commit — delete it or release by hand`)
  }

  const lockVersions = [lock.version, lock.packages?.['']?.version]
  if (lockVersions.some(v => v !== version)) problems.push(`package-lock.json says ${lockVersions.find(v => v !== version)}, package.json says ${version} — bump with \`npm version ${version} --no-git-tag-version\``)

  const list = headings(changelog)
  if (list[0]?.version !== version) problems.push(`newest CHANGELOG section is ${list[0]?.version ?? 'missing'}, expected ${version} at the top`)
  else {
    const prev = list[1]?.version
    const expected = prev ? `${REPO}/compare/v${prev}...v${version}` : `${REPO}/releases/tag/v${version}`
    const actual = footerFor(changelog, version)
    if (actual === null) problems.push(`CHANGELOG has no link definition "[${version}]: …" at the bottom; add: [${version}]: ${expected}`)
    else if (actual !== expected) problems.push(`CHANGELOG link for [${version}] is ${actual}; expected ${expected}`)
  }
  return problems
}

function refuseIf(problems) {
  if (!problems.length) return
  for (const p of problems) console.error(`release-check: ${p}`)
  console.error(`release-check: refusing to release ${version} (${problems.length} problem${problems.length > 1 ? 's' : ''})`)
  process.exit(1)
}

function emit(o) {
  const out = { version, publish: false, release: false, create_tag: false, latest: false, target: '', dry_run: false, ...o }
  for (const [k, v] of Object.entries(out)) process.stdout.write(`${k}=${v}\n`)
  process.exit(0)
}

// --- the commit a repair tags --------------------------------------------------
// It must be the commit npm published, or the tag disagrees with the package's
// provenance. npm records it as gitHead; use that when it is on this branch. With
// no record, take the first commit on this branch's first-parent line that set
// the version: in a merge-commit workflow that is the merge on main, not the
// release commit on the PR branch, whose tree differs. Anything else is refused.
function repairTarget() {
  const recorded = flag('npm-githead') ?? npmGitHead()
  if (recorded && recorded !== 'none') {
    if (isAncestorOfHead(recorded)) return recorded
    refuseIf([`repair path: npm says ${version} was published from ${recorded}, which is not on this branch; tag and release it by hand`])
  }
  const found = lines(sh('git', ['log', '--first-parent', '--reverse', '--format=%H', '-G', `"version": "${version}"`, '--', 'package.json']))[0]
  if (!found) refuseIf([`repair path: cannot find the commit on this branch that set package.json's version to ${version}; tag and release it by hand`])
  return found
}
function npmGitHead() {
  try { return sh('npm', ['view', `${pkg.name}@${version}`, 'gitHead']) || null } catch { return null }
}
function isAncestorOfHead(sha) {
  try { execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: root, stdio: 'ignore' }); return true } catch { return false }
}

// --- decide -------------------------------------------------------------------
if (mode === 'pr') {
  if (flag('base-version') === version) {
    console.error(`release-check: version unchanged (${version}); not a release PR`)
    emit({})
  }
  refuseIf(problemsFor({ requireNewer: true, npm: npmVersions(), tagList: [] }))
  console.error(`release-check: ${version} is ready to release once merged`)
  emit({ publish: true })
}

if (mode === 'dry-run') {
  refuseIf(problemsFor({ requireNewer: false, npm: [], tagList: [] }))
  console.error(`release-check: dry run for ${version}`)
  emit({ publish: true, dry_run: true })
}

// mode === 'push'
const npm = npmVersions()
const tagList = tags()
const released = releases()
const publish = !npm.includes(version)
const hasTag = tagList.includes(`v${version}`)
const release = !(hasTag && released.includes(`v${version}`))
if (!publish && !release) {
  console.error(`release-check: ${version} is on npm and released; nothing to do`)
  emit({})
}
if (publish) refuseIf(problemsFor({ requireNewer: true, npm, tagList }))
else if (sectionBody(changelog, version) === null) refuseIf([`repair path: CHANGELOG has no section for ${version}, so there are no notes`])

const higherRelease = stable(released.map(t => t.replace(/^v/, ''))).some(v => compare(v, version) > 0)
const target = flag('target') ?? (publish ? sh('git', ['rev-parse', 'HEAD']) : repairTarget())
console.error(`release-check: ${publish ? 'publish and release' : 'repair: release only'} ${version} at ${target}`)
emit({ publish, release, create_tag: !hasTag, latest: !higherRelease, target })
