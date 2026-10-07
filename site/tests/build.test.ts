import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { SCENARIOS } from '../src/playground/scenarios'
import { headings } from '../../scripts/changelog.mjs'

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

describe('front page', () => {
  const html = () => readFileSync(dist('index.html'), 'utf8')
  it('shows the newest CHANGELOG version in a pill linking to its release', () => {
    const newest = headings(readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8'))[0].version
    const m = html().match(/<a href="(https:\/\/github\.com\/iremlopsum\/liaise\/releases\/tag\/[^"]+)"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/)
    expect(m?.[1]).toBe(`https://github.com/iremlopsum/liaise/releases/tag/v${newest}`)
    expect(m?.[2]).toBe(newest)
    const sentence = html().match(/releases\/tag\/[^"]+"[^>]*>\s*<span[^>]*>[^<]*<\/span>\s*([^<]*?)\s*<span aria-hidden/)?.[1] ?? ''
    expect(sentence.length).toBeGreaterThan(0)
    expect(sentence).not.toContain('`')
    expect(sentence).not.toContain('](')
  })
  it('states the gzipped size from compare/results.json', () => {
    const results = JSON.parse(readFileSync(new URL('../../compare/results.json', import.meta.url), 'utf8'))
    expect(html()).toContain(`about ${Math.round(results.sizes.liaise.gzip / 1024)}&nbsp;kB gzipped`)
  })
  it('has exactly five problem rows, each linking to a guide page that exists', () => {
    const rows = [...html().matchAll(/<a href="(\/liaise\/guide\/[^"]+\/)"[^>]*data-problem/g)].map(m => m[1])
    expect(rows).toHaveLength(5)
    for (const r of rows) expect(existsSync(dist(`${r.replace('/liaise/', '')}index.html`)), r).toBe(true)
  })
  it('renders all six playground tabs', () => {
    for (const s of SCENARIOS) expect(html()).toMatch(new RegExp(`<button[^>]*data-id="${s.id}"[^>]*>${s.label}</button>`))
  })
  it('loads neither the editor nor graphql-js up front', () => {
    const files = loadedUpFront('index.html')
    expect(files.size).toBeGreaterThan(0)
    for (const [f, text] of files) expect(onDemand(f, text), `loads ${f} up front`).toBe(false)
  })
  it('is left out of the search index', () => {
    expect(html()).not.toContain('data-pagefind-body')
    const urls = distFiles(/^pagefind\/fragment\/.*\.pf_fragment$/).map(f => JSON.parse(gunzipSync(readFileSync(dist(f))).toString('utf8').replace(/^pagefind_dcd/, '')).url as string)
    expect(urls.length).toBeGreaterThan(0)
    expect(urls).toContain('/guide/handling-errors/')
    expect(urls).not.toContain('/')
  })
  describe('meta', () => {
    const pages = () => distFiles(/\.html$/).filter(f => !f.startsWith('pagefind/'))
    it('every page has a unique title and a description', () => {
      const titles = new Map<string, string>()
      for (const f of pages()) {
        const html = readFileSync(dist(f), 'utf8')
        const title = html.match(/<title>([^<]+)<\/title>/)?.[1]
        expect(title, `${f} title`).toBeTruthy()
        expect(titles.get(title!), `${f} repeats the title of ${titles.get(title!)}`).toBeUndefined()
        titles.set(title!, f)
        expect(html, `${f} description`).toMatch(/<meta name="description" content="[^"]{20,}"/)
      }
    })
    it('every page carries absolute Open Graph tags that point at the base', () => {
      for (const f of pages()) {
        const html = readFileSync(dist(f), 'utf8')
        expect(html, f).toContain('<meta property="og:image" content="https://iremlopsum.github.io/liaise/og.png"')
        expect(html, f).toMatch(/<meta property="og:url" content="https:\/\/iremlopsum\.github\.io\/liaise\/[^"]*"/)
        expect(html, f).toMatch(/<meta property="og:title" content="[^"]+"/)
        expect(html, f).toMatch(/<meta property="og:description" content="[^"]+"/)
        expect(html, f).toContain('<meta name="twitter:card" content="summary_large_image"')
      }
    })
    it('ships a 1200x630 PNG for og:image', () => {
      const png = readFileSync(dist('og.png'))
      expect(png.subarray(1, 4).toString()).toBe('PNG')
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630])
    })
    it('lists the docs pages in the sitemap, under the base', () => {
      const index = readFileSync(dist('sitemap-index.xml'), 'utf8')
      expect(index).toContain('https://iremlopsum.github.io/liaise/sitemap-0.xml')
      const map = readFileSync(dist('sitemap-0.xml'), 'utf8')
      expect(map).toContain('<loc>https://iremlopsum.github.io/liaise/guide/handling-errors/</loc>')
      expect(map).toContain('<loc>https://iremlopsum.github.io/liaise/compare/</loc>')
      expect(map).not.toContain('/404')
    })
  })
})
