import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { SCENARIOS } from '../src/playground/scenarios'

const dist = (p: string) => new URL(`../dist/${p}`, import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
const distFiles = (re: RegExp) => readdirSync(dist(''), { recursive: true }).map(String).filter(f => re.test(f))

// The scripts and stylesheets a page loads before anything runs: the files its HTML names, and
// what they import statically. A dynamic import() is not followed: it loads later, on demand.
function loadedUpFront(page: string) {
  const files = new Map<string, string>()
  const queue = [...readFileSync(dist(page), 'utf8').matchAll(/\/liaise\/(_astro\/[^"'`\s)]+\.(?:js|css))/g)].map(m => m[1])
  for (let f = queue.pop(); f !== undefined; f = queue.pop()) {
    if (files.has(f)) continue
    const text = readFileSync(dist(f), 'utf8')
    files.set(f, text)
    // Static imports between chunks; a match inside a string literal names no chunk, so it is skipped.
    if (f.endsWith('.js'))
      for (const m of text.matchAll(/\b(?:import|export)\s*(?:[\w$*{}\s,]*?from\s*)?["'`]\.\/([^"'`]+\.js)["'`]/g))
        if (existsSync(dist(`_astro/${m[1]}`))) queue.push(`_astro/${m[1]}`)
  }
  return files
}
// What loads only on demand: Monaco (its code reads MonacoEnvironment, its stylesheets style
// .monaco-editor) and graphql-js (its validator says "Cannot query field").
const onDemand = (file: string, text: string) =>
  file.endsWith('.js') ? text.includes('MonacoEnvironment') || text.includes('Cannot query field') : text.includes('.monaco-editor')

describe('built site', () => {
  it('has a front page with the current version in the header', () => {
    const html = readFileSync(dist('index.html'), 'utf8')
    expect(html).toContain(`v${pkg.version}`)
    expect(html).toContain('<link rel="canonical" href="https://iremlopsum.github.io/liaise/"')
  })
  it('serves everything under /liaise/ and ships no CNAME', () => {
    const html = readFileSync(dist('index.html'), 'utf8')
    expect(html).not.toMatch(/(href|src)="\/(?!liaise\/)[^"\/]/)
    expect(existsSync(dist('CNAME'))).toBe(false)
  })
  it('ships no prototype switch and no illustration code', () => {
    const html = readFileSync(dist('index.html'), 'utf8')
    expect(html).not.toMatch(/data-font-switch|data-accent-switch|Prototype/)
  })
  it('has a search index', () => {
    expect(existsSync(dist('pagefind/pagefind.js'))).toBe(true)
  })

  it('renders the playground tabs as HTML, on every page that has one', () => {
    const pages = distFiles(/\.html$/).filter(f => readFileSync(dist(f), 'utf8').includes('data-playground'))
    expect(pages).toContain('playground/index.html')
    expect(SCENARIOS.map(s => s.label)).toEqual(['Quick start', 'Every failure', 'Search as you type', 'Share', 'Retry', 'GraphQL'])
    for (const page of pages) {
      const html = readFileSync(dist(page), 'utf8')
      expect(html.match(/<button[^>]*role="tab"/g), page).toHaveLength(6)
      for (const s of SCENARIOS) expect(html).toMatch(new RegExp(`<button[^>]*data-id="${s.id}"[^>]*>${s.label}</button>`))
    }
  })
  it('loads nothing from a CDN', () => {
    for (const f of distFiles(/\.(html|js|css)$/)) expect(readFileSync(dist(f), 'utf8'), f).not.toContain('cdn.jsdelivr.net')
  })
  it('ships the editor and graphql-js to no docs page, and to the playground only on demand', () => {
    for (const page of ['guide/handling-errors/index.html', 'playground/index.html']) {
      const files = loadedUpFront(page)
      expect(files.size, page).toBeGreaterThan(0)
      for (const [f, text] of files) expect(onDemand(f, text), `${page} loads ${f} up front`).toBe(false)
    }
  })
})
