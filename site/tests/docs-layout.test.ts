import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

const page = (p: string) => readFileSync(new URL(`../dist/${p}/index.html`, import.meta.url), 'utf8')

describe('docs pages', () => {
  it('render under /<group>/<slug>/ with sidebar groups in order', () => {
    const full = page('guide/handling-errors')
    const html = full.slice(full.indexOf('<aside data-sidebar'), full.indexOf('</aside>', full.indexOf('<aside data-sidebar')))
    expect(html.length).toBeGreaterThan(0)
    const order = ['Getting started', 'Guide', 'Recipes', 'Choosing liaise', 'Reference', 'About'].map(l => html.indexOf(`>${l}<`))
    expect(order.every(i => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
  it('link to the previous and next page in sidebar order', () => {
    const html = page('guide/handling-errors')
    // Anchored on the Previous/Next labels: the sidebar links to both pages regardless of order.
    expect(html).toMatch(/href="\/liaise\/guide\/defining-endpoints\/"[^>]*>\s*<span[^>]*>Previous<\/span>\s*<span[^>]*>[^<]*Defining endpoints/)
    expect(html).toMatch(/href="\/liaise\/guide\/sending-data\/"[^>]*>\s*<span[^>]*>Next<\/span>\s*<span[^>]*>[^<]*Sending data/)
  })
  it('mark the current page in the sidebar', () => {
    expect(page('guide/handling-errors')).toMatch(/aria-current="page"[^>]*>Handling errors</)
  })
  it('are searchable', () => {
    expect(existsSync(new URL('../dist/pagefind/pagefind-entry.json', import.meta.url))).toBe(true)
    const entry = JSON.parse(readFileSync(new URL('../dist/pagefind/pagefind-entry.json', import.meta.url), 'utf8'))
    expect(Object.values<any>(entry.languages)[0].page_count).toBeGreaterThanOrEqual(40)
  })
})
