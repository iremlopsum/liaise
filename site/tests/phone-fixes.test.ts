import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'

const dist = new URL('../dist/', import.meta.url)
const page = (p: string) => readFileSync(new URL(`${p ? p + '/' : ''}index.html`, dist), 'utf8')
const header = (html: string) => html.slice(html.indexOf('<header'), html.indexOf('</header>'))

describe('wide tables', () => {
  it('sit in a keyboard-scrollable, named region, so the page itself never scrolls sideways', () => {
    const html = page('reference/createapi-options')
    const article = html.slice(html.indexOf('<article'), html.indexOf('</article>'))
    const tables = article.match(/<table/g) ?? []
    expect(tables.length).toBeGreaterThan(0)
    const wrapped = article.match(/<div class="table-scroll" role="region" aria-label="[^"]+" tabindex="0"><table/g) ?? []
    expect(wrapped.length).toBe(tables.length)
  })
  it('the wrapper scrolls on its own: the built stylesheet says so', () => {
    const css = readdirSync(new URL('_astro/', dist)).filter(f => f.endsWith('.css')).map(f => readFileSync(new URL(`_astro/${f}`, dist), 'utf8')).join('')
    expect(css).toMatch(/\.table-scroll\{[^}]*overflow-x:auto/)
  })
})

describe('header navigation', () => {
  it('marks no section current on the front page', () => {
    expect(header(page(''))).not.toContain('aria-current')
  })
  it('still marks Docs on a docs page', () => {
    expect(header(page('guide/handling-errors'))).toMatch(/aria-current="true"[^>]*>Docs</)
  })
})

describe('favicon', () => {
  it('is built, and every page links it under the base', () => {
    expect(existsSync(new URL('favicon.svg', dist))).toBe(true)
    for (const p of ['', 'guide/handling-errors', 'playground', 'compare'])
      expect(page(p), p).toContain('<link rel="icon" type="image/svg+xml" href="/liaise/favicon.svg"')
  })
})
