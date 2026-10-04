import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const script = join(__dirname, '..', 'scripts', 'check-readme.mjs')
let dir: string

function run(readme: string, tests: Record<string, string>) {
  writeFileSync(join(dir, 'README.md'), readme)
  mkdirSync(join(dir, 'tests', 'recipes'), { recursive: true })
  for (const [name, text] of Object.entries(tests)) writeFileSync(join(dir, 'tests', name), text)
  try {
    const out = execFileSync('node', [script, '--readme', join(dir, 'README.md'), '--tests', join(dir, 'tests')], { encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status as number, out: String(e.stdout) + String(e.stderr) }
  }
}

const block = (name: string, code: string) => `<!-- tested: ${name} -->\n\n\`\`\`ts\n${code}\n\`\`\`\n`
const region = (name: string, code: string) => `// readme:${name}:start\n${code}\n// readme:${name}:end\n`

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'check-readme-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('check-readme', () => {
  it('passes when every tested block equals its region', () => {
    const r = run(block('a', 'const x = 1'), { 'recipes/a.test.ts': region('a', 'const x = 1') })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/1 tested blocks match/)
  })

  it('ignores indentation and trailing whitespace differences', () => {
    const r = run(block('a', 'if (x) {\n  y()\n}'), { 'recipes/a.test.ts': `describe('x', () => {\n  ${region('a', '  if (x) {   \n    y()\n  }').replace(/\n/g, '\n  ')}})` })
    expect(r.code).toBe(0)
  })

  it('reports a block that differs, naming it and the first differing line', () => {
    const r = run(block('a', 'const x = 1\nconst y = 2'), { 'recipes/a.test.ts': region('a', 'const x = 1\nconst y = 3') })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/"a".*line 2/s)
    expect(r.out).toContain('const y = 3')
  })

  it('reports a README marker with no test region', () => {
    const r = run(block('lonely', 'x()'), {})
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/"lonely".*no test region/)
  })

  it('reports a test region with no README block', () => {
    const r = run('# nothing\n', { 'recipes/a.test.ts': region('orphan', 'x()') })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/"orphan".*not in the README/)
  })

  it('reports a start marker with no end marker', () => {
    const r = run(block('a', 'x()'), { 'recipes/a.test.ts': '// readme:a' + ':start\nx()\n' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/"a".*no matching end/)
  })

  it('reports a marker not followed by a code block', () => {
    const r = run('<!-- tested: a -->\n\nJust prose.\n', { 'recipes/a.test.ts': region('a', 'x()') })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/"a".*not followed by a code block/)
  })

  it('reports a link to a missing heading', () => {
    const r = run('# Title\n\n## Use `share`\n\nSee [share](#use-share) and [gone](#nowhere).\n', {})
    expect(r.code).toBe(1)
    expect(r.out).toContain('#nowhere')
    expect(r.out).not.toContain('#use-share')
  })

  it('resolves GitHub-style duplicate heading anchors', () => {
    const r = run('## Middleware\n\n## Middleware\n\n[a](#middleware) [b](#middleware-1)\n', {})
    expect(r.code).toBe(0)
  })

  it('ignores anchors inside code blocks', () => {
    const r = run('## A\n\n```md\n[x](#not-a-real-link)\n```\n', {})
    expect(r.code).toBe(0)
  })
})
