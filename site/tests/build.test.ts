import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

const dist = (p: string) => new URL(`../dist/${p}`, import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

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
})
