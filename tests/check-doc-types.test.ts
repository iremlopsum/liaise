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

describe('check-doc-types', () => {
  it('passes a snippet that uses liaise correctly', () => {
    const r = run({ 'a.md': fence("import { createApi, defineRequest } from 'liaise'\nconst getUser = defineRequest<{ id: string }>()({ method: 'GET', path: '/users/:id' })\nconst api = createApi({ baseUrl: '/api', requests: { getUser } })\nvoid api.getUser({ id: '1' })") })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/1 snippet type-checks/)
  })

  it('fails a snippet with a wrong option, naming the file and line', () => {
    const r = run({ 'a.md': 'Intro\n' + fence("import { createApi } from 'liaise'\ncreateApi({ baseUrl: '/api', requests: {}, timout: 3000 })") })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/a\.md:\d+.*timout/)
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
  })
})
