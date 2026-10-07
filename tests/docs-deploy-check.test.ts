import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const script = join(__dirname, '..', 'scripts', 'docs-deploy-check.mjs')
let dir: string

const git = (...a: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...a], { cwd: dir, stdio: 'pipe' })
const write = (path: string, content: string) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), content)
}
const pkg = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: 'liaise', version: '1.0.0', scripts: { build: 'tsc' }, devDependencies: { vitest: '1' },
    exports: { '.': './dist/index.js' }, dependencies: {}, ...extra,
  }, null, 2)
const commit = (msg = 'c') => { git('add', '-A'); git('commit', '-q', '-m', msg) }

function run() {
  let code = 0, out = '', err = ''
  try {
    out = execFileSync('node', [script, '--root', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e: any) {
    code = e.status; out = String(e.stdout); err = String(e.stderr)
  }
  return { code, out, err }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'docs-deploy-'))
  git('init', '-q')
  write('package.json', pkg())
  write('tsconfig.json', '{"compilerOptions":{"target":"ES2020"}}')
  write('tsconfig.build.json', '{"extends":"./tsconfig.json"}')
  write('tsconfig.types.json', '{"extends":"./tsconfig.json"}')
  write('tsconfig.test.json', '{"extends":"./tsconfig.json"}')
  write('src/index.ts', 'export {}')
  write('README.md', 'a')
  commit('initial')
  git('tag', 'v1.0.0')
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('docs-deploy-check', () => {
  it('passes when only site/ and README.md changed', () => {
    write('site/page.md', 'x'); write('README.md', 'b'); commit()
    const r = run()
    expect(r.code).toBe(0)
    expect(r.out).toContain('docs-deploy: ok (no library change since v1.0.0)')
  })

  it('passes when only package.json scripts or devDependencies changed', () => {
    write('package.json', pkg({ scripts: { build: 'tsc', 'docs:check': 'x' }, devDependencies: { vitest: '2' }, description: 'new' })); commit()
    const r = run()
    expect(r.code).toBe(0)
    expect(r.out).toContain('ok')
  })

  it('refuses when a file under src/ changed', () => {
    write('src/x.ts', 'export const x = 1'); commit()
    const r = run()
    expect(r.code).toBe(1)
    expect(r.err).toContain('docs-deploy: library code changed since v1.0.0 (src/x.ts): release first')
  })

  it('refuses when tsconfig.json changed', () => {
    write('tsconfig.json', '{"compilerOptions":{"target":"ES2022"}}'); commit()
    const r = run()
    expect(r.code).toBe(1)
    expect(r.err).toContain('tsconfig.json')
  })

  it('refuses when package.json exports changed', () => {
    write('package.json', pkg({ exports: { '.': './dist/index.js', './extra': './dist/extra.js' } })); commit()
    const r = run()
    expect(r.code).toBe(1)
    expect(r.err).toContain('package.json exports')
  })

  it('refuses when dependencies changed', () => {
    write('package.json', pkg({ dependencies: { left: '1' } })); commit()
    const r = run()
    expect(r.code).toBe(1)
    expect(r.err).toContain('package.json dependencies')
  })

  it('compares against the latest tag by version, not the oldest or a string sort', () => {
    git('tag', 'v5.9.0')
    write('src/y.ts', 'export {}'); commit()
    git('tag', 'v5.10.0')
    write('site/p.md', 'x'); commit()
    const r = run()
    expect(r.code).toBe(0)
    expect(r.out).toContain('since v5.10.0')
  })

  it('refuses when no v* tag exists', () => {
    git('tag', '-d', 'v1.0.0')
    const r = run()
    expect(r.code).toBe(1)
    expect(r.err).toContain('no v* release tag')
  })

  it('refuses when tsconfig.build.json or tsconfig.types.json changed', () => {
    write('tsconfig.build.json', '{"extends":"./tsconfig.json","compilerOptions":{"removeComments":true}}'); commit()
    let r = run()
    expect(r.code).toBe(1)
    expect(r.err).toContain('tsconfig.build.json')
    write('tsconfig.types.json', '{"extends":"./tsconfig.json","compilerOptions":{"declarationMap":true}}'); commit()
    r = run()
    expect(r.err).toContain('tsconfig.types.json')
  })

  it('passes when only tsconfig.test.json changed (the build does not read it)', () => {
    write('tsconfig.test.json', '{"extends":"./tsconfig.json","compilerOptions":{"types":["node"]}}'); commit()
    expect(run().code).toBe(0)
  })

  it('ignores prerelease tags', () => {
    write('src/y.ts', 'export {}'); commit()
    git('tag', 'v1.1.0-rc.1')
    const r = run()
    expect(r.code).toBe(1)
    expect(r.err).toContain('since v1.0.0')
  })

  it('reports a clean message when package.json cannot be read at the tag', () => {
    git('rm', '-q', 'package.json'); commit()
    git('tag', 'v2.0.0')
    write('package.json', pkg()); commit()
    const r = run()
    expect(r.code).toBe(1)
    expect(r.err).toContain('docs-deploy: cannot read package.json at v2.0.0')
    expect(r.err).not.toContain('at changedShipped')
  })
})
