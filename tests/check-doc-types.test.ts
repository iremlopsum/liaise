import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const script = join(__dirname, '..', 'scripts', 'check-doc-types.mjs')
let dir: string
const fence = (code: string, before = '') => `${before}\n\`\`\`ts\n${code}\n\`\`\`\n`
function run(files: Record<string, string>) {
  for (const [f, text] of Object.entries(files)) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), text) }
  try {
    return { code: 0, out: execFileSync('node', [script, '--root', join(__dirname, '..'), '--src', ...Object.keys(files).map(f => join(dir, f))], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (e: any) { return { code: e.status as number, out: String(e.stdout) + String(e.stderr) } }
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'doc-types-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

// Most tests here start a real `tsc` over liaise's types and the prelude: about 0.7 s on a
// laptop, up to ~5 s on a CI runner with other test files competing — past vitest's 5 s
// default, which failed Node 22 and 24 on PR #10. The work is bounded, so allow it the time.
describe('check-doc-types', { timeout: 60_000 }, () => {
  it('passes a snippet that uses liaise correctly', () => {
    const r = run({ 'a.md': fence("import { createApi, defineRequest } from 'liaise'\nconst getUser = defineRequest<{ id: string }>()({ method: 'GET', path: '/users/:id' })\nconst api = createApi({ baseUrl: '/api', requests: { getUser } })\nvoid api.getUser({ id: '1' })") })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/1 snippet type-checks/)
  })

  it('fails a snippet with a wrong option, naming the file and line', () => {
    const r = run({ 'a.md': 'Intro\n' + fence("import { createApi } from 'liaise'\ncreateApi({ baseUrl: '/api', requests: {}, timout: 3000 })") })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/a\.md:5: .*timout/)
  })

  it('knows the placeholders from the prelude', () => {
    const r = run({ 'a.md': fence("show('hello'); render([]); const u: User = { id: '1', name: 'Ada' }; void u") })
    expect(r.code).toBe(0)
  })

  it('skips a block marked untyped and counts it', () => {
    const r = run({ 'a.md': fence('this is not TypeScript', '<!-- untyped: shows the shape of a response, not code -->') })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/1 skipped/)
  })

  it('refuses an untyped marker without a reason', () => {
    const r = run({ 'a.md': fence('nope', '<!-- untyped: -->') })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/untyped.*needs a reason/)
  })

  it('type-checks a playground example file as a whole', () => {
    const r = run({ 'ex.ts': "import { createApi } from 'liaise'\nconst api = createApi({ baseUrl: 'x', requests: {} })\nvoid api\n" })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/1 snippet type-checks/)
  })

  it('fails a playground example file with a wrong option, naming file and line', () => {
    const r = run({ 'ex.ts': "import { createApi } from 'liaise'\ncreateApi({ baseUrl: 'x', requests: {}, timout: 1 })\n" })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ex\.ts:2: .*timout/)
  })

  it('excludes a block included from a test', () => {
    const r = run({ 'a.md': fence('this would not compile', '<!-- tested: some-example -->') })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/0 snippets type-check/)
  })

  it('checks against the prelude client, so a wrong option on api fails', () => {
    const r = run({ 'a.md': fence("void api.getUser({ id: '1' }, { timout: 3000 })") })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/timout/)
    expect(run({ 'b.md': fence("void api.getUsr({ id: '1' })") }).code).toBe(1)
  })

  it('checks an indented fence (a list item) and de-indents it', () => {
    const r = run({ 'a.md': "- item\n\n  ```ts\n  import { createApi } from 'liaise'\n  createApi({ baseUrl: '/api', requests: {}, timout: 3000 })\n  ```\n" })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/a\.md:5: .*timout/)
  })

  it('checks a fence that carries a meta string', () => {
    const r = run({ 'a.md': "```ts title=\"x.ts\"\nimport { createApi } from 'liaise'\ncreateApi({ baseUrl: '/api', requests: {}, timout: 3000 })\n```\n" })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/a\.md:3: .*timout/)
  })

  it('honours an untyped marker before an indented fence', () => {
    const r = run({ 'a.md': "- item\n\n  <!-- untyped: a fragment -->\n  ```ts\n  not code\n  ```\n" })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/1 skipped/)
  })

  it('accepts the MDX untyped marker, and refuses it without a reason', () => {
    const ok = run({ 'a.mdx': fence('not code', '{/* untyped: a type sketch */}') })
    expect(ok.code).toBe(0)
    expect(ok.out).toMatch(/1 skipped/)
    const bad = run({ 'b.mdx': fence('not code', '{/* untyped: */}') })
    expect(bad.code).toBe(1)
    expect(bad.out).toMatch(/untyped.*needs a reason/)
  })

  it('fails the run when the prelude itself has a type error', () => {
    writeFileSync(join(dir, 'bad-prelude.d.ts'), "declare const broken: import('liaise').NoSuchExport\n")
    writeFileSync(join(dir, 'a.md'), fence('export {}'))
    let out = '', code = 0
    try { out = execFileSync('node', [script, '--root', join(__dirname, '..'), '--prelude', join(dir, 'bad-prelude.d.ts'), '--src', join(dir, 'a.md')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch (e: any) { code = e.status; out = String(e.stdout) + String(e.stderr) }
    expect(code).toBe(1)
    expect(out).toMatch(/bad-prelude\.d\.ts.*NoSuchExport/)
  })
})
