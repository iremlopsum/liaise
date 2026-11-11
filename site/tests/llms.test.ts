// The agent-facing files, against site/dist: llms.txt, llms-full.txt, a .md per docs page, and the
// links to them that an agent's fetch can see (a page's links, not its <head>).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { findRegions } from '../../scripts/examples.mjs'

const dist = new URL('../dist/', import.meta.url).pathname
const docs = new URL('../src/content/docs/', import.meta.url).pathname
const ROOT = 'https://iremlopsum.github.io/liaise'
const read = (p: string) => readFileSync(join(dist, p), 'utf8')
const ids = readdirSync(docs, { recursive: true }).map(String).filter((f) => /\.mdx?$/.test(f)).map((f) => f.replace(/\.mdx?$/, ''))
const toFile = (u: string) => u.slice(ROOT.length + 1).replace(/#.*/, '').replace(/\/$/, '/index.html')

describe('llms.txt', () => {
  const txt = read('llms.txt')
  it('follows llmstxt.org: an H1 name, a blockquote summary, then H2 sections of links', () => {
    expect(txt).toMatch(/^# liaise\n\n> .+\n/)
    expect(txt).toMatch(/\n## Getting started\n\n- \[/)
    expect(txt).toContain(`${ROOT}/llms-full.txt`)
  })
  it('lists every docs page, by its .md address, with its description', () => {
    for (const id of ids) {
      const fm = readFileSync(join(docs, existsSync(join(docs, `${id}.mdx`)) ? `${id}.mdx` : `${id}.md`), 'utf8')
      const description = fm.match(/^description: "(.*)"$/m)?.[1]
      expect(txt, id).toContain(`(${ROOT}/${id}.md)${description ? `: ${description}` : ''}`)
    }
  })
  it('every link in it resolves to a built file', () => {
    const missing = [...txt.matchAll(/\]\((https:\/\/iremlopsum\.github\.io\/liaise\/[^)]+)\)/g)].map((m) => m[1]).filter((u) => !existsSync(join(dist, toFile(u))))
    expect(missing).toEqual([])
  })
})

describe('the Markdown copies', () => {
  const { regions } = findRegions(new URL('../../tests/', import.meta.url).pathname)
  it('exist for every docs page, and for /compare/', () => {
    expect(ids.length).toBeGreaterThanOrEqual(40)
    for (const id of [...ids, 'compare']) expect(existsSync(join(dist, `${id}.md`)), id).toBe(true)
  })
  it('carry no MDX: every <Example> became its region as code, and no root link is left relative', () => {
    for (const id of ids) {
      const md = read(`${id}.md`)
      expect(md, id).not.toMatch(/<Example|\{\/\*/)
      expect(md, id).not.toMatch(/\]\(\//)
      const src = readFileSync(join(docs, existsSync(join(docs, `${id}.mdx`)) ? `${id}.mdx` : `${id}.md`), 'utf8')
      for (const [, name] of src.matchAll(/<Example name="([a-z0-9-]+)"/g)) {
        const first = regions.get(name)!.code.split('\n').find((l: string) => l.trim())!
        expect(md, `${id}: ${name}`).toContain(first)
      }
    }
  })
  it('every absolute link to the site in them resolves to a built file', () => {
    const missing: string[] = []
    for (const id of [...ids, 'compare']) {
      for (const [, u] of read(`${id}.md`).matchAll(/\]\((https:\/\/iremlopsum\.github\.io\/liaise\/[^)\s]*)\)/g)) {
        if (!existsSync(join(dist, toFile(u)))) missing.push(`${id}: ${u}`)
      }
    }
    expect(missing).toEqual([])
  })
  it('llms-full.txt holds every page, in sidebar order, then the comparison', () => {
    const full = read('llms-full.txt')
    const llms = read('llms.txt')
    const order = [...llms.matchAll(/\]\(https:\/\/iremlopsum\.github\.io\/liaise\/([a-z-]+\/[a-z0-9-]+)\.md\)/g)].map((m) => m[1]).filter((id) => !id.startsWith('about/'))
    const at = order.map((id) => full.indexOf(`Source: ${ROOT}/${id}/\n`))
    expect(at.every((i) => i > 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(full).toContain(`Source: ${ROOT}/compare/\n`)
  })
})

describe('what an agent fetching the HTML can see', () => {
  it('each docs page links to its Markdown copy in the page body, and names it in the head', () => {
    for (const id of ids) {
      const html = read(`${id}/index.html`)
      const body = html.slice(html.indexOf('<body'))
      expect(body, id).toMatch(new RegExp(`<a href="/liaise/${id}\\.md"[^>]*>View as Markdown</a>`))
      expect(html, id).toContain(`<link rel="alternate" type="text/markdown" href="/liaise/${id}.md">`)
    }
  })
  it('the front page says what liaise is in plain text, and links llms.txt and llms-full.txt', () => {
    for (const page of ['index.html', 'intro/index.html']) {
      const about = read(page).match(/<p class="about" data-about>([\s\S]*?)<\/p>/)?.[1] ?? ''
      expect(about, page).toContain('Type-safe REST and GraphQL')
      expect(about, page).toContain('href="/liaise/llms.txt"')
      expect(about, page).toContain('href="/liaise/llms-full.txt"')
    }
  })
})
