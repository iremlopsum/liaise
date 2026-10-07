import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const script = join(__dirname, '..', 'scripts', 'release-notes.mjs')
const repoChangelog = join(__dirname, '..', 'CHANGELOG.md')
let dir: string

const CHANGELOG = `# Changelog

Intro paragraph with [a link](https://keepachangelog.com/).

## [2.0.0] — 2026-10-02

Big change. See [MIGRATION.md](./MIGRATION.md#upgrading-to-200).

### Fixed

- one thing

## [1.1.0] — 2026-10-01

Middle: [readme](README.md), [site](https://example.com), [anchor](#x), [mail](mailto:a@b.c).

## [1.0.0] — 2026-09-30

First release.

[2.0.0]: https://github.com/iremlopsum/liaise/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/iremlopsum/liaise/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/iremlopsum/liaise/releases/tag/v1.0.0
`

function run(args: string[]) {
  try {
    return { code: 0, out: execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (e: any) {
    return { code: e.status as number, out: String(e.stdout) + String(e.stderr) }
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'release-notes-'))
  writeFileSync(join(dir, 'CHANGELOG.md'), CHANGELOG)
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('release-notes', () => {
  it('prints the newest section without its heading, up to the next heading', () => {
    const r = run(['2.0.0', '--changelog', join(dir, 'CHANGELOG.md')])
    expect(r.code).toBe(0)
    expect(r.out).toBe(
      'Big change. See [MIGRATION.md](https://github.com/iremlopsum/liaise/blob/main/MIGRATION.md#upgrading-to-200).\n' +
      '\n### Fixed\n\n- one thing\n',
    )
  })

  it('makes relative links absolute and leaves absolute, anchor and mailto links alone', () => {
    const r = run(['1.1.0', '--changelog', join(dir, 'CHANGELOG.md')])
    expect(r.code).toBe(0)
    expect(r.out).toBe(
      'Middle: [readme](https://github.com/iremlopsum/liaise/blob/main/README.md), [site](https://example.com), [anchor](#x), [mail](mailto:a@b.c).\n',
    )
  })

  it('stops the oldest section before the link definitions', () => {
    const r = run(['1.0.0', '--changelog', join(dir, 'CHANGELOG.md')])
    expect(r.code).toBe(0)
    expect(r.out).toBe('First release.\n')
  })

  it('fails with a message for a version the CHANGELOG does not have', () => {
    const r = run(['9.9.9', '--changelog', join(dir, 'CHANGELOG.md')])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no "## \[9\.9\.9\]" section/)
  })

  it('prints usage without a version', () => {
    const r = run([])
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/usage/)
  })

  it('handles the real 5.1.0 section: absolute MIGRATION link, no relative one left', () => {
    const r = run(['5.1.0', '--changelog', repoChangelog])
    expect(r.code).toBe(0)
    expect(r.out.startsWith('Fixes a security bug in `share`')).toBe(true)
    expect(r.out).toContain('(https://github.com/iremlopsum/liaise/blob/main/MIGRATION.md#upgrading-to-510)')
    expect(r.out).not.toContain('](./')
    expect(r.out).not.toMatch(/^## \[/m)
  })
})
