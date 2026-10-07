import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dist = new URL('../dist/', import.meta.url).pathname
const pages = readdirSync(dist, { recursive: true }).map(String).filter(f => f.endsWith('.html'))
const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]))

describe('internal links', () => {
  it('every internal href resolves to a page, and every #anchor to an id on it', () => {
    const dead: string[] = []
    for (const f of pages) {
      const html = readFileSync(join(dist, f), 'utf8')
      for (const m of html.matchAll(/href="(\/[^"#?]*)(#[^"]*)?"/g)) {
        const [, full, hash] = m
        // GitHub Pages serves the site under /liaise/: a root link without it would 404.
        if (!full.startsWith('/liaise/')) { dead.push(`${f}: ${full} (missing the /liaise base)`); continue }
        const path = full.slice('/liaise'.length)
        const target = path.endsWith('/') ? join(dist, path, 'index.html') : join(dist, path)
        if (!existsSync(target)) { dead.push(`${f}: ${path}`); continue }
        if (hash && hash.length > 1 && !ids(readFileSync(target, 'utf8')).has(decodeURIComponent(hash.slice(1)))) dead.push(`${f}: ${path}${hash}`)
      }
      for (const m of html.matchAll(/href="(#[^"]+)"/g)) if (!ids(html).has(decodeURIComponent(m[1].slice(1)))) dead.push(`${f}: ${m[1]}`)
    }
    expect(dead).toEqual([])
  })
})
