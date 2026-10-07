import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const script = join(__dirname, '..', 'scripts', 'release-check.mjs')
let dir: string

const changelog = (top: string, prev = '1.0.0', footer?: string) => `# Changelog

## [${top}] — 2026-10-07

Something.

## [${prev}] — 2026-10-01

Before.

${footer ?? `[${top}]: https://github.com/iremlopsum/liaise/compare/v${prev}...v${top}`}
[${prev}]: https://github.com/iremlopsum/liaise/releases/tag/v${prev}
`

const migration = (...versions: string[]) =>
  `# Migration Guide\n\n${versions.map(v => `## Upgrading to ${v}\n\nNo action needed.\n`).join('\n---\n\n')}`

function repo(opts: { version: string; lock?: string; changelog?: string; migration?: string }) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'liaise', version: opts.version }))
  const lock = opts.lock ?? opts.version
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ name: 'liaise', version: lock, packages: { '': { name: 'liaise', version: lock } } }))
  writeFileSync(join(dir, 'CHANGELOG.md'), opts.changelog ?? changelog(opts.version))
  writeFileSync(join(dir, 'MIGRATION.md'), opts.migration ?? migration(opts.version))
}

function run(mode: string, flags: Record<string, unknown> = {}) {
  const args = ['--mode', mode, '--root', dir, '--target', 'abc123']
  for (const [k, v] of Object.entries(flags)) args.push(`--${k}`, typeof v === 'string' ? v : JSON.stringify(v))
  let code = 0, out = '', err = ''
  try {
    out = execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e: any) {
    code = e.status; out = String(e.stdout); err = String(e.stderr)
  }
  const outputs = Object.fromEntries(out.trim().split('\n').filter(Boolean).map(l => l.split('=') as [string, string]))
  return { code, outputs, err }
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'release-check-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('release-check, push', () => {
  it('a new version with a complete CHANGELOG is published and released', () => {
    repo({ version: '1.1.0' })
    const r = run('push', { 'npm-versions': ['1.0.0'], tags: ['v1.0.0'], releases: ['v1.0.0'] })
    expect(r.code).toBe(0)
    expect(r.outputs).toEqual({ version: '1.1.0', publish: 'true', release: 'true', create_tag: 'true', latest: 'true', target: 'abc123', dry_run: 'false' })
  })

  it('a version npm has and GitHub has released means nothing to do', () => {
    repo({ version: '1.1.0' })
    const r = run('push', { 'npm-versions': ['1.0.0', '1.1.0'], tags: ['v1.1.0'], releases: ['v1.1.0'] })
    expect(r.code).toBe(0)
    expect(r.outputs.publish).toBe('false')
    expect(r.outputs.release).toBe('false')
  })

  it('a version npm has but GitHub has not released takes the repair path', () => {
    repo({ version: '1.1.0' })
    const r = run('push', { 'npm-versions': ['1.0.0', '1.1.0'], tags: ['v1.1.0'], releases: ['v1.0.0'] })
    expect(r.code).toBe(0)
    expect(r.outputs).toMatchObject({ publish: 'false', release: 'true', create_tag: 'false' })
  })

  it('the repair path creates the tag when it is missing too', () => {
    repo({ version: '1.1.0' })
    const r = run('push', { 'npm-versions': ['1.1.0'], tags: [], releases: [] })
    expect(r.outputs).toMatchObject({ publish: 'false', release: 'true', create_tag: 'true' })
  })

  it('refuses a missing footer link', () => {
    repo({ version: '1.1.0', changelog: changelog('1.1.0', '1.0.0', '') })
    const r = run('push', { 'npm-versions': ['1.0.0'], tags: [], releases: [] })
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/no link definition "\[1\.1\.0\]: …"/)
  })

  it('refuses a footer that compares against the wrong previous version', () => {
    repo({ version: '1.1.0', changelog: changelog('1.1.0', '1.0.0', '[1.1.0]: https://github.com/iremlopsum/liaise/compare/v0.9.0...v1.1.0') })
    const r = run('push', { 'npm-versions': ['1.0.0'], tags: [], releases: [] })
    expect(r.code).toBe(1)
    expect(r.err).toContain('https://github.com/iremlopsum/liaise/compare/v1.0.0...v1.1.0')
  })

  it('refuses a CHANGELOG whose newest section is another version', () => {
    repo({ version: '1.2.0', changelog: changelog('1.1.0') })
    const r = run('push', { 'npm-versions': ['1.1.0'], tags: [], releases: [] })
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/newest CHANGELOG section is 1\.1\.0, expected 1\.2\.0/)
  })

  it('refuses a version lower than the newest on npm', () => {
    repo({ version: '1.1.0' })
    const r = run('push', { 'npm-versions': ['1.0.0', '2.0.0'], tags: [], releases: [] })
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/1\.1\.0 is not newer than 2\.0\.0/)
  })

  it('refuses a prerelease', () => {
    repo({ version: '1.1.0-beta.1', changelog: changelog('1.1.0-beta.1') })
    const r = run('push', { 'npm-versions': ['1.0.0'], tags: [], releases: [] })
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/prerelease/)
  })

  it('refuses a lockfile that carries another version', () => {
    repo({ version: '1.1.0', lock: '1.0.0' })
    const r = run('push', { 'npm-versions': ['1.0.0'], tags: [], releases: [] })
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/package-lock\.json says 1\.0\.0/)
  })

  it('refuses when the tag already exists but npm does not have the version', () => {
    repo({ version: '1.1.0' })
    const r = run('push', { 'npm-versions': ['1.0.0'], tags: ['v1.1.0'], releases: [] })
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/tag v1\.1\.0 already exists/)
  })

  it('lists every problem at once', () => {
    repo({ version: '1.1.0', lock: '1.0.0', changelog: changelog('1.1.0', '1.0.0', '') })
    const r = run('push', { 'npm-versions': ['1.0.0'], tags: [], releases: [] })
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/package-lock\.json/)
    expect(r.err).toMatch(/link definition/)
  })

  it('is not marked Latest when a higher version is already released (a backport)', () => {
    // npm's newest stable is 1.0.0, so 1.1.0 may publish; a 2.0.0 GitHub Release
    // already exists, so 1.1.0 must not take Latest from it.
    repo({ version: '1.1.0' })
    const r = run('push', { 'npm-versions': ['1.0.0'], tags: ['v2.0.0'], releases: ['v2.0.0'] })
    expect(r.code).toBe(0)
    expect(r.outputs.latest).toBe('false')
  })
})

describe('release-check, pr', () => {
  it('passes a PR that does not change the version', () => {
    repo({ version: '1.0.0', changelog: changelog('1.0.0', '0.9.0') })
    const r = run('pr', { 'base-version': '1.0.0', 'npm-versions': ['1.0.0'] })
    expect(r.code).toBe(0)
    expect(r.outputs.publish).toBe('false')
  })

  it('checks a PR that bumps the version', () => {
    repo({ version: '1.1.0', changelog: changelog('1.1.0', '1.0.0', '') })
    const r = run('pr', { 'base-version': '1.0.0', 'npm-versions': ['1.0.0'] })
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/link definition/)
  })

  it('refuses a bump with no MIGRATION.md entry, naming the heading to add', () => {
    repo({ version: '1.1.0', changelog: changelog('1.1.0', '1.0.0'), migration: migration('1.0.0') })
    const r = run('pr', { 'base-version': '1.0.0', 'npm-versions': ['1.0.0'] })
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/MIGRATION\.md has no "## Upgrading to 1\.1\.0"/)
  })

  it('passes a bump whose MIGRATION.md entry only says no action is needed', () => {
    repo({ version: '1.1.0', changelog: changelog('1.1.0', '1.0.0'), migration: migration('1.1.0', '1.0.0') })
    const r = run('pr', { 'base-version': '1.0.0', 'npm-versions': ['1.0.0'] })
    expect(r.code).toBe(0)
  })

  it('needs the base version', () => {
    repo({ version: '1.1.0' })
    const r = run('pr', { 'npm-versions': ['1.0.0'] })
    expect(r.code).toBe(2)
  })
})

describe('release-check, dry-run', () => {
  it('runs on an already-published version and never releases', () => {
    repo({ version: '1.0.0', changelog: changelog('1.0.0', '0.9.0') })
    const r = run('dry-run', { 'npm-versions': ['1.0.0'], tags: ['v1.0.0'], releases: ['v1.0.0'] })
    expect(r.code).toBe(0)
    expect(r.outputs).toMatchObject({ version: '1.0.0', publish: 'true', release: 'false', dry_run: 'true' })
  })

  it('still refuses a broken CHANGELOG', () => {
    repo({ version: '1.0.0', changelog: changelog('1.0.0', '0.9.0', '') })
    const r = run('dry-run', { 'npm-versions': ['1.0.0'], tags: [], releases: [] })
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/no link definition "\[1\.0\.0\]: …"/)
  })
})

// The target commit, against real git history. This repo merges release PRs with
// merge commits, so the commit npm published (and the tag must name) is the merge
// on main, not the "chore(release)" commit on the PR branch.
describe('release-check, target commit (real git)', () => {
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = (message: string) => { git('add', '-A'); git('commit', '-q', '-m', message); return git('rev-parse', 'HEAD') }
  function writeVersion(version: string, compact: boolean) {
    const pkg = { name: 'liaise', version }
    // npm writes package.json with two-space indentation; `compact` imitates a hand edit.
    writeFileSync(join(dir, 'package.json'), compact ? JSON.stringify(pkg) : JSON.stringify(pkg, null, 2) + '\n')
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ name: 'liaise', version, packages: { '': { name: 'liaise', version } } }, null, 2) + '\n')
    writeFileSync(join(dir, 'CHANGELOG.md'), changelog(version))
    writeFileSync(join(dir, 'MIGRATION.md'), migration(version))
  }
  /** main: A (1.0.0) ─ C ─ M (merges the PR branch, whose B bumps to 1.1.0) ─ D */
  function mergedRelease(compact = false) {
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'test'); git('config', 'commit.gpgsign', 'false')
    writeVersion('1.0.0', compact); commit('A')
    git('checkout', '-q', '-b', 'release')
    writeVersion('1.1.0', compact); const B = commit('chore(release): 1.1.0')
    git('checkout', '-q', 'main')
    writeFileSync(join(dir, 'other.txt'), 'x'); commit('C')
    git('merge', '-q', '--no-ff', '-m', 'Merge pull request: release 1.1.0', 'release')
    const M = git('rev-parse', 'HEAD')
    writeFileSync(join(dir, 'docs.txt'), 'y'); const D = commit('D: docs after the release')
    return { B, M, D }
  }
  function runGit(flags: Record<string, unknown>) {
    const args = ['--mode', 'push', '--root', dir]
    for (const [k, v] of Object.entries(flags)) args.push(`--${k}`, typeof v === 'string' ? v : JSON.stringify(v))
    let code = 0, out = '', err = ''
    try { out = execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch (e: any) { code = e.status; out = String(e.stdout); err = String(e.stderr) }
    return { code, err, outputs: Object.fromEntries(out.trim().split('\n').filter(Boolean).map(l => l.split('=') as [string, string])) }
  }

  it('publish targets HEAD', () => {
    const { D } = mergedRelease()
    const r = runGit({ 'npm-versions': ['1.0.0'], tags: [], releases: [] })
    expect(r.code).toBe(0)
    expect(r.outputs.target).toBe(D)
  })

  it('repair targets the merge commit on main, not the release commit on the PR branch', () => {
    const { B, M } = mergedRelease()
    const r = runGit({ 'npm-versions': ['1.0.0', '1.1.0'], tags: [], releases: [], 'npm-githead': 'none' })
    expect(r.code).toBe(0)
    expect(r.outputs.target).not.toBe(B)
    expect(r.outputs.target).toBe(M)
  })

  it('repair targets the commit npm recorded when it is on main', () => {
    const { D } = mergedRelease()
    const r = runGit({ 'npm-versions': ['1.0.0', '1.1.0'], tags: [], releases: [], 'npm-githead': D })
    expect(r.code).toBe(0)
    expect(r.outputs.target).toBe(D)
  })

  it('repair refuses when npm recorded a commit that is not on main', () => {
    mergedRelease()
    const r = runGit({ 'npm-versions': ['1.0.0', '1.1.0'], tags: [], releases: [], 'npm-githead': '1111111111111111111111111111111111111111' })
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/not on this branch/)
  })

  it('repair refuses when no commit on main introduced the version', () => {
    mergedRelease(true)
    const r = runGit({ 'npm-versions': ['1.0.0', '1.1.0'], tags: [], releases: [], 'npm-githead': 'none' })
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/cannot find the commit/)
  })
})
