import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'

const dist = (p: string) => new URL(`../dist/${p}`, import.meta.url)
const files = () => readdirSync(dist('_astro')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(dist(`_astro/${f}`), 'utf8'))
const src = (f: string) => readFileSync(new URL(`../src/analytics/${f}`, import.meta.url), 'utf8')

describe('the collector in the built site', () => {
  it('is at most 5 kB gzipped, bundled and minified', async () => {
    const out = await build({ entryPoints: [new URL('../src/analytics/index.ts', import.meta.url).pathname], bundle: true, minify: true, format: 'esm', write: false, define: { 'import.meta.env.PUBLIC_ANALYTICS_EMULATOR': 'undefined', 'import.meta.env.BASE_URL': '"/liaise/"' } })
    expect(gzipSync(out.outputFiles[0].contents).length).toBeLessThanOrEqual(5120) // 5.0 kB measured 2026-10-08 (5,030 B); 3 kB would need the intro's recording split into its own bundle (ruling R6)
  })
  it('never touches cookies or browser storage', () => {
    for (const f of readdirSync(new URL('../src/analytics/', import.meta.url)))
      expect(src(f), f).not.toMatch(/document\.cookie|localStorage|sessionStorage|indexedDB/)
  })
  it('ships no Firebase SDK in any site bundle, and no emulator address', () => {
    for (const text of files()) {
      expect(text).not.toContain('FirebaseError')
      expect(text).not.toContain('127.0.0.1:8080')
      expect(text).not.toContain('demo-liaise-analytics')
    }
    expect(files().some((t) => t.includes('documents:commit'))).toBe(true)
  })
  it('the search list says which query its results are for, which the collector waits for', () => {
    // Base.astro's inline script, as built: data-q is set with the results (or No results), never before.
    const html = readFileSync(dist('start/quick-start/index.html'), 'utf8')
    expect(html).toMatch(/const q = input\.value\.trim\(\)[\s\S]*?list\.innerHTML = pages\.map[\s\S]*?list\.dataset\.q = q\n/)
    // What was typed while Pagefind loaded is searched once it has, so its results do arrive.
    expect(html).toContain("if (pagefind && input.value.trim()) input.dispatchEvent(new Event('input'))")
    expect(src('index.ts')).toContain("dataset.q === q")
  })
  it('the Privacy page is built and listed under About', () => {
    expect(readFileSync(dist('about/privacy/index.html'), 'utf8')).toContain('Global Privacy Control')
    expect(readFileSync(dist('start/quick-start/index.html'), 'utf8')).toContain('href="/liaise/about/privacy/"')
  })
})
