import { describe, it, expect, vi } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { SCENARIOS } from '../src/playground/scenarios'
import { whatsNewFor } from '../src/data/whats-new'
import { introLength } from '../src/intro/length'
import { SLIDES } from '../src/intro/engine/slides'
import { INTRO_KEY } from '../src/intro/flag'

const dist = (p: string) => new URL(`../dist/${p}`, import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
const distFiles = (re: RegExp) => readdirSync(dist(''), { recursive: true }).map(String).filter(f => re.test(f))
const htmlPages = () => distFiles(/\.html$/).filter(f => !f.startsWith('pagefind/'))
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')

// The scripts and stylesheets a page loads before anything runs: the files its HTML names, and
// what they import statically. A dynamic import() is not followed: it loads later, on demand.
function loadedUpFront(page: string) {
  const files = new Map<string, string>()
  // A path inside import(…) (a small script Astro inlined into the page) loads on demand, not up front.
  const queue = [...readFileSync(dist(page), 'utf8').matchAll(/(import\(\s*)?["'`]?\/liaise\/(_astro\/[^"'`\s)]+\.(?:js|css))/g)].filter(m => !m[1]).map(m => m[2])
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
    expect(SCENARIOS.map(s => s.label)).toEqual(['Quick start', 'Every failure', 'Search as you type', 'Share', 'Retry', 'GraphQL', 'Polling'])
    for (const page of pages) {
      const html = readFileSync(dist(page), 'utf8')
      expect(html.match(/<button[^>]*role="tab"/g), page).toHaveLength(SCENARIOS.length)
      for (const s of SCENARIOS) expect(html).toMatch(new RegExp(`<button[^>]*data-id="${s.id}"[^>]*>${s.label}</button>`))
    }
  })
  it('never says better or faster, on any page', () => {
    // What a reader sees: the text without tags, scripts and styles, and the description search engines show.
    for (const f of htmlPages()) {
      const html = readFileSync(dist(f), 'utf8')
      const text = decode(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')
      const description = decode(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '')
      expect(`${text} ${description}`.match(/.{0,50}\b(better|faster)\b.{0,50}/i)?.[0], f).toBeUndefined()
    }
  })
  it('stores everything under a liaise: key, since iremlopsum.github.io is shared with other sites', () => {
    let calls = 0
    for (const f of htmlPages()) {
      const html = readFileSync(dist(f), 'utf8')
      for (const m of html.matchAll(/localStorage\.(\w+)\(([^),]*)/g)) {
        calls++
        // A bare name is a define:vars constant Astro wrote into the same script: check what it holds.
        const arg = m[2].trim()
        const value = /^\w+$/.test(arg) ? html.match(new RegExp(`const ${arg} = ("[^"]*")`))?.[1] ?? arg : arg
        expect(value, `${f}: localStorage.${m[1]}(${m[2]}…)`).toMatch(/^(['"])liaise:[\w-]+\1$/)
      }
    }
    expect(calls).toBeGreaterThan(0)
  })
  it('shows the copy button on code blocks on keyboard focus and on touch screens, not only on hover', () => {
    const css = distFiles(/^_astro\/.*\.css$/).map(f => readFileSync(dist(f), 'utf8')).find(t => t.includes('.code-copy'))
    expect(css, 'a stylesheet styles .code-copy').toBeDefined()
    // A rule whose selector list includes the selector, and whose block sets opacity: 1.
    const shown = (selector: string) => new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(,[^{}]*)?\\{[^}]*opacity:\\s*1\\b`)
    expect(css).toMatch(shown('.code-copy:focus-visible'))
    expect(css).toMatch(shown('.code-wrap:focus-within .code-copy'))
    expect(css).toMatch(/@media\s*\(hover:\s*none\)\s*\{[^{}]*\.code-copy\s*\{[^}]*opacity:\s*1\b/)
  })
  it('loads nothing from a CDN', () => {
    for (const f of distFiles(/\.(html|js|css)$/)) expect(readFileSync(dist(f), 'utf8'), f).not.toMatch(/cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com/)
  })
  it('ships the editor and graphql-js to no docs page, and to the playground only on demand', () => {
    for (const page of ['guide/handling-errors/index.html', 'playground/index.html', 'index.html', 'intro/index.html']) {
      const files = loadedUpFront(page)
      expect(files.size, page).toBeGreaterThan(0)
      for (const [f, text] of files) expect(onDemand(f, text), `${page} loads ${f} up front`).toBe(false)
    }
  })
})

describe('front page', () => {
  const html = () => readFileSync(dist('index.html'), 'utf8')
  it('shows the released version, package.json\'s, in a pill linking to its release', () => {
    const m = html().match(/<a href="(https:\/\/github\.com\/iremlopsum\/liaise\/releases\/tag\/[^"]+)"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/)
    expect(m?.[1]).toBe(`https://github.com/iremlopsum/liaise/releases/tag/v${pkg.version}`)
    expect(m?.[2]).toBe(pkg.version)
    const sentence = html().match(/releases\/tag\/[^"]+"[^>]*>\s*<span[^>]*>[^<]*<\/span>\s*([^<]*?)\s*<span aria-hidden/)?.[1] ?? ''
    expect(sentence.length).toBeGreaterThan(0)
    expect(sentence).not.toContain('`')
    expect(sentence).not.toContain('](')
  })
  it('takes the pill from the released version\'s CHANGELOG section, never a newer one merged ahead of its release', () => {
    const changelog = [
      '# Changelog', '',
      '## [9.0.0] — 2026-12-01', '', 'Not released yet. Still not.', '',
      '## [5.1.1] — 2026-10-07', '', 'Fixes `gql.query.x` in [the split client](./README.md#x). More text.', '',
      '[9.0.0]: https://example.com', '',
    ].join('\n')
    expect(whatsNewFor(changelog, '5.1.1')).toEqual({
      version: '5.1.1', text: 'Fixes gql.query.x in the split client.', href: 'https://github.com/iremlopsum/liaise/releases/tag/v5.1.1',
    })
    // No section for the released version: no pill, rather than another version's.
    expect(whatsNewFor(changelog, '5.2.0')).toBeNull()
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
    expect(urls).not.toContain('/intro/')
  })
  it('starts on the intro: logo, headline, Start with the steps and length the slides add up to, and the install command', () => {
    const h = decode(html())
    expect(h).toMatch(/<svg[^>]*class="brand-mark"[\s\S]*?stroke-current[\s\S]*?stroke-accent/)
    expect(h).toContain('Your API calls, minus the surprises.')
    expect(h).toContain('Watch an API client get written, one line at a time.')
    expect(h).toMatch(/<button[^>]*data-intro-start[^>]*>Start<\/button>/)
    expect(h).toContain(`${SLIDES.length + 1} steps, about ${introLength()}. Enter works too.`)
    expect(h).toContain('<span data-copy-text>npm install liaise</span>')
  })
  // Remotion's own code links its docs in its messages, and React marks its elements with
  // Symbol.for('react.transitional.element'): markers that survive minification. The last two
  // expectations below fail if no chunk carries one, so a marker can't silently match nothing. If one
  // does fail, grep the chunks mount.tsx imports for a string only that library has, and use that.
  const remotion = (text: string) => text.includes('remotion.dev')
  const react = (text: string) => text.includes('react.transitional.element')
  it('loads React, Remotion and the slides only on demand', () => {
    for (const page of ['index.html', 'intro/index.html'])
      for (const [f, text] of loadedUpFront(page)) {
        expect(remotion(text), `${page} loads Remotion up front, in ${f}`).toBe(false)
        expect(react(text), `${page} loads React up front, in ${f}`).toBe(false)
      }
    const chunks = distFiles(/^_astro\/.*\.js$/).map((f) => readFileSync(dist(f), 'utf8'))
    expect(chunks.some(remotion), 'a chunk carries Remotion').toBe(true)
    expect(chunks.some(react), 'a chunk carries React').toBe(true)
  })
  it('keeps Monaco out of the intro until step 10: no chunk carries both', () => {
    for (const f of distFiles(/^_astro\/.*\.js$/)) {
      const text = readFileSync(dist(f), 'utf8')
      expect(remotion(text) && text.includes('MonacoEnvironment'), f).toBe(false)
    }
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
        if (f !== '404.html') expect(html, f).toMatch(/<meta property="og:url" content="https:\/\/iremlopsum\.github\.io\/liaise\/[^"]*"/)
        expect(html, f).toMatch(/<meta property="og:title" content="[^"]+"/)
        expect(html, f).toMatch(/<meta property="og:description" content="[^"]+"/)
        expect(html, f).toContain('<meta name="twitter:card" content="summary_large_image"')
      }
    })
    it('keeps the 404 page out of the index: noindex, no canonical, no og:url', () => {
      const html = readFileSync(dist('404.html'), 'utf8')
      expect(html).toContain('<meta name="robots" content="noindex"')
      expect(html).not.toContain('rel="canonical"')
      expect(html).not.toContain('og:url')
    })
    it('ships a 1200x630 PNG for og:image', () => {
      expect(existsSync(dist('og.png')), 'og.png is shipped').toBe(true)
      const png = readFileSync(dist('og.png'))
      expect(png.subarray(1, 4).toString()).toBe('PNG')
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630])
    })
    it('lists the docs pages in the sitemap, under the base', () => {
      expect(existsSync(dist('sitemap-index.xml')), 'sitemap-index.xml is generated').toBe(true)
      const index = readFileSync(dist('sitemap-index.xml'), 'utf8')
      expect(index).toContain('https://iremlopsum.github.io/liaise/sitemap-0.xml')
      expect(existsSync(dist('sitemap-0.xml')), 'sitemap-0.xml is generated').toBe(true)
      const map = readFileSync(dist('sitemap-0.xml'), 'utf8')
      expect(map).toContain('<loc>https://iremlopsum.github.io/liaise/guide/handling-errors/</loc>')
      expect(map).toContain('<loc>https://iremlopsum.github.io/liaise/compare/</loc>')
      expect(map).not.toContain('/404')
    })
  })
})

describe('header', () => {
  it('reaches Docs, Playground and Compare on a phone, from every page, and GitHub, which leaves the phone header so it fits at 320 px', () => {
    for (const f of htmlPages()) {
      const html = readFileSync(dist(f), 'utf8')
      // The desktop links sit in a nav that only shows from md up; below md, a menu button opens the same three.
      const opener = html.match(/<button[^>]*\spopovertarget="site-menu"[^>]*>/)?.[0]
      expect(opener, `${f}: a button opens the site menu`).toBeDefined()
      const classes = opener!.match(/\sclass="([^"]*)"/)?.[1].split(/\s+/) ?? []
      expect(classes, `${f}: the menu button shows below md`).toContain('md:hidden')
      expect(classes, `${f}: the menu button shows below md`).not.toContain('hidden')
      const menu = html.match(/<nav[^>]*\sid="site-menu"[^>]*>([\s\S]*?)<\/nav>/)
      expect(menu?.[0], `${f}: the site menu is a popover`).toMatch(/^<nav[^>]*\spopover="auto"/)
      expect([...menu![1].matchAll(/<a href="([^"]+)"/g)].map(m => m[1]), f).toEqual(['/liaise/start/quick-start/', '/liaise/playground/', '/liaise/compare/', 'https://github.com/iremlopsum/liaise'])
      const github = html.match(/<a href="https:\/\/github\.com\/iremlopsum\/liaise"[^>]*aria-label="GitHub"[^>]*>/)?.[0] ?? ''
      expect(github.match(/\sclass="([^"]*)"/)?.[1].split(/\s+/), `${f}: the header's GitHub icon shows from md up`).toEqual(expect.arrayContaining(['hidden', 'md:grid']))
    }
  })
})

describe('remembering the intro, and the way back', () => {
  const page = (p: string) => readFileSync(dist(p), 'utf8')
  // The inline head script index.astro writes, as built.
  const redirect = (html: string) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('location.replace'))

  it('sends a browser that has seen the intro to Quick start from the head, and shows the intro when storage throws', () => {
    const html = page('index.html')
    const script = redirect(html)!
    expect(script).toBeDefined()
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('</head>'))
    // performance: how the browser came to the page (Navigation Timing), as the script reads it.
    const came = (type: string) => ({ getEntriesByType: (t: string) => (t === 'navigation' ? [{ type }] : []) })
    const run = (storage: { getItem(key: string): string | null }, performance: unknown = came('navigate'), from = { referrer: '', search: '' }) => {
      const location = { replace: vi.fn(), origin: 'https://iremlopsum.github.io', search: from.search }
      new Function('localStorage', 'location', 'performance', 'document', script)(storage, location, performance, { referrer: from.referrer })
      return location.replace
    }
    const seen = { getItem: (k: string) => (k === INTRO_KEY ? 'skipped' : null) }
    // Quick start's referrer will be this page, so the redirect says it came from here (via=front).
    const quick = '/liaise/start/quick-start/?via=front'
    expect(run(seen)).toHaveBeenCalledWith(quick)
    expect(run({ getItem: () => null })).not.toHaveBeenCalled()
    expect(run({ getItem: () => { throw new DOMException('blocked', 'SecurityError') } })).not.toHaveBeenCalled()
    // Back from Quick start: the page wasn't kept by the back/forward cache, so the script runs again.
    // Redirecting then would undo the Back.
    expect(run(seen, came('back_forward'))).not.toHaveBeenCalled()
    expect(run(seen, came('reload'))).toHaveBeenCalledWith(quick)
    // A browser without Navigation Timing still redirects.
    expect(run(seen, {})).toHaveBeenCalledWith(quick)
  })
  it('carries another site\'s origin and the address\'s ref and utm tags through the redirect, and nothing else', () => {
    const script = redirect(page('index.html'))!
    const run = (referrer: string, search: string) => {
      const location = { replace: vi.fn(), origin: 'https://iremlopsum.github.io', search }
      new Function('localStorage', 'location', 'performance', 'document', script)({ getItem: () => 'done' }, location, {}, { referrer })
      return location.replace
    }
    expect(run('https://github.com/iremlopsum/liaise', '?utm_source=newsletter&utm_campaign=Launch%20Week&gclid=x'))
      .toHaveBeenCalledWith('/liaise/start/quick-start/?via=front&r=https%3A%2F%2Fgithub.com&utm_source=newsletter&utm_campaign=Launch%20Week')
    expect(run('https://iremlopsum.github.io/liaise/compare/', '?ref=readme')).toHaveBeenCalledWith('/liaise/start/quick-start/?via=front&ref=readme')
    expect(run('not a url', '')).toHaveBeenCalledWith('/liaise/start/quick-start/?via=front')
  })
  it('never redirects /intro/', () => {
    expect(redirect(page('intro/index.html'))).toBeUndefined()
    expect(page('intro/index.html')).toContain('data-intro-start')
  })
  it('marks Skip to docs as skipping on both routes, and the Docs link on the front page only', () => {
    const marked = (html: string) => [...html.matchAll(/<a\b[^>]*\bdata-skip-intro\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, '')).trim())
    expect(marked(page('index.html'))).toEqual(expect.arrayContaining(['Docs', 'Skip to docs →']))
    expect(marked(page('intro/index.html'))).toEqual(['Skip to docs →'])
    expect(page('start/quick-start/index.html')).not.toContain('data-skip-intro')
  })
  it('hides the theme toggle on the intro, and only there', () => {
    // The button, not the string: Base's inline script names [data-theme-toggle] on every page.
    const toggle = /<button[^>]*data-theme-toggle/
    expect(page('index.html')).not.toMatch(toggle)
    expect(page('intro/index.html')).not.toMatch(toggle)
    expect(page('start/quick-start/index.html')).toMatch(toggle)
  })
  it('links to /intro/ first under Getting started and from the top of Quick start, with the length the slides add up to', () => {
    const html = page('start/quick-start/index.html')
    const len = introLength()
    expect(html).toMatch(new RegExp(`<a href="/liaise/intro/"[^>]*>Intro <span[^>]*>· ${len}</span></a>`))
    expect(html.indexOf('href="/liaise/intro/"')).toBeLessThan(html.indexOf('href="/liaise/start/the-problem-it-solves/"'))
    expect(decode(html)).toContain(`New here? <a href="/liaise/intro/">Watch the ${len.replace(/ minutes?$/, '-minute')} intro</a>.`)
  })
})
