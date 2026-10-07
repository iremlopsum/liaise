import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { NAMES, METHOD_FOR, OVERHEAD, cell } from '../../compare/cells.mjs'
import { KINDS, ky, type Kind } from '../src/compare'

const html = () => readFileSync(new URL('../dist/compare/index.html', import.meta.url), 'utf8')
const data = JSON.parse(readFileSync(new URL('../../compare/results.json', import.meta.url), 'utf8'))

describe('/compare', () => {
  it('shows every scenario, for both variants', () => {
    for (const s of data.scenarios) expect(html()).toContain(s.title)
    expect(html()).toMatch(/data-variant="configured"/)
    expect(html()).toMatch(/data-variant="default"/)
  })
  it('names when and against what it was measured', () => {
    expect(html()).toContain(data.meta.date)
    for (const [name, v] of Object.entries<string>(data.meta.versions)) if (name !== 'fetch') expect(html()).toContain(v)
  })
  it('renders sizes from the data', () => {
    expect(html()).toContain((data.sizes.liaise.gzip / 1024).toFixed(1))
  })
  it('states where liaise loses', () => {
    expect(html()).toMatch(/Where liaise loses/)
    expect(html()).toMatch(/no default timeout/i)
  })
  it('keeps the matrix and its marker legend out of the search index, and the prose in', () => {
    const dir = new URL('../dist/pagefind/fragment/', import.meta.url)
    const pages = readdirSync(dir).map(f => JSON.parse(gunzipSync(readFileSync(new URL(f, dir))).toString('utf8').replace(/^pagefind_dcd/, '')))
    const page = pages.find(p => p.url === '/compare/')
    expect(page, '/compare/ is indexed').toBeDefined()
    const content = decode(page.content)
    for (const k of Object.values(KINDS)) expect(content, 'the marker legend').not.toContain(k.help)
    // A cell reads as its outcome, then its marker. The "Closest alternative: ky" table renders some
    // cells the same way and stays indexed, so what it shows is left out of the check.
    const shown = (s: any, n: string, v: Variant) => { const c = cell(s, n, v); return `${c.text}${KINDS[c.kind as Kind].label}` }
    const kyTable = ky.rows.flatMap((s: any) => ['ky', 'liaise'].map(n => shown(s, n, 'configured')))
    let checked = 0
    for (const v of VARIANTS) for (const s of data.scenarios) for (const n of LIBRARIES) {
      if (kyTable.some(k => k.includes(shown(s, n, v)))) continue
      checked++
      expect(content, `${v}/${s.id}/${n}`).not.toContain(shown(s, n, v))
    }
    expect(checked).toBeGreaterThan(50)
    for (const prose of ['Where liaise loses', 'Closest alternative: ky', 'Pick something else when']) expect(content).toContain(prose)
  })
})

// Every sentence on /compare/ with a number or a ranking in it is computed from results.json at
// build time. These tests compute the same facts here, from the data, and read them off the page.
type Variant = 'configured' | 'default'
type Mode = 'sequential' | 'concurrent'
const VARIANTS: Variant[] = ['configured', 'default']
const MODES: Mode[] = ['sequential', 'concurrent']

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const textOf = (fragment: string) => decode(fragment.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The text of the element carrying data-fact="<name>". Fact elements never nest their own tag. */
function fact(name: string) {
  const m = html().match(new RegExp(`<(\\w+)[^>]*\\sdata-fact="${escapeRe(name)}"[^>]*>([\\s\\S]*?)</\\1>`))
  expect(m, `data-fact="${name}"`).not.toBeNull()
  return textOf(m![2])
}
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)
const kb = (b: number) => (b / 1024).toFixed(1)
const scenario = (id: string) => data.scenarios.find((s: any) => s.id === id)
const outcome = (id: string, name: string, v: Variant): string => scenario(id).results[name][v].outcome
// The matrix compares libraries; plain fetch is not one (owner, 2026-10-07). It is measured as
// the baseline for size and overhead. Written out here, not read from site/src/compare.ts, so a
// fetch column creeping back fails the test.
const LIBRARIES = ['axios', 'ky', 'ofetch', 'liaise']
/** Everything liaise's overhead is compared with: the libraries and the plain-fetch baseline. */
const others = NAMES.filter(n => n !== 'liaise')
/** The libraries liaise is weighed against. */
const libraries = LIBRARIES.filter(n => n !== 'liaise')
const display = (n: string) => (n === 'fetch' ? 'plain fetch' : n)
const section = (v: Variant) => { const h = html(); const a = h.indexOf(`<section id="cmp-${v}"`); return h.slice(a, h.indexOf('</section>', a)) }
const distPage = (href: string) => new URL(`../dist/${href.replace(/^\/liaise\//, '')}index.html`, import.meta.url)

describe('/compare from compare/results.json', () => {
  it('renders every cell with the text and kind compare/cells.mjs gives it, in the table and in the cards', () => {
    for (const v of VARIANTS) for (const s of data.scenarios) for (const n of LIBRARIES) {
      const c = cell(s, n, v)
      const buttons = [...html().matchAll(new RegExp(`<button[^>]*\\sdata-cell="${v}/${s.id}/${n}"[^>]*>([\\s\\S]*?)</button>`, 'g'))]
      expect(buttons.length, `${v}/${s.id}/${n}`).toBe(2)
      for (const b of buttons) {
        expect(b[0], `${v}/${s.id}/${n}`).toContain(`data-kind="${c.kind}"`)
        expect(textOf(b[1]), `${v}/${s.id}/${n}`).toContain(c.text)
      }
    }
  })

  it('has exactly the four library columns in both setups, and no fetch column or card', () => {
    for (const v of VARIANTS) {
      const sec = section(v)
      expect(sec.length, v).toBeGreaterThan(0)
      expect([...sec.matchAll(/<th[^>]*\sdata-col="([^"]+)"/g)].map(m => m[1]), `${v} table columns`).toEqual(LIBRARIES)
      const ol = sec.slice(sec.indexOf('<ol'), sec.indexOf('</ol>'))
      const cards = ol.split(/<li class="rounded-xl/).slice(1)
      expect(cards.length, `${v} cards`).toBe(data.scenarios.length)
      for (const card of cards) expect([...card.matchAll(/\sdata-cell="[^/]+\/[^/]+\/([^"]+)"/g)].map(m => m[1]), `${v} card rows`).toEqual(LIBRARIES)
      expect(sec, v).not.toMatch(/data-cell="[^"]*\/fetch"|data-col="fetch"|id="cmp-[a-z]+-fetch-/)
    }
  })

  it('leaves fetch out of every sentence derived from the matrix', () => {
    for (const f of ['code-count-configured', 'code-count-default', 'liaise-code', 'path-param', 'ky-rows', 'ky-defaults', 'ky-size',
      'loses-timeout', 'loses-204', 'loses-retries', 'loses-size', 'size-place'])
      expect(fact(f), f).not.toMatch(/\bfetch\b/)
    expect(textOf(html())).toContain(`runs ${list(LIBRARIES)} through ${data.scenarios.length} failure scenarios`)
  })

  it('marks a cell as throws whenever its outcome throws, also after a scenario prefix', () => {
    // "after 3.9s: throws HTTPError, 3 attempts" threw; it must not be marked "no throw".
    for (const v of VARIANTS) for (const s of data.scenarios) for (const n of NAMES) {
      const c = cell(s, n, v)
      const threw = /(?:^|: )throws\b/.test(s.results[n][v].outcome)
      if (c.kind !== 'code') expect(c.kind === 'throws', `${v}/${s.id}/${n}: ${s.results[n][v].outcome}`).toBe(threw)
    }
  })

  it("opens each cell's setup note, with the note's doc links", () => {
    const methods = [...new Set(Object.values(METHOD_FOR))]
    for (const v of VARIANTS) for (const n of LIBRARIES) for (const m of methods) {
      const r = data.scenarios[0].results[n]
      const note: string | undefined = (v === 'configured' ? r.notes : r.defaultNotes)?.[m]
      const id = `cmp-${v}-${n}-${m}`
      const pop = html().match(new RegExp(`<div[^>]*\\sid="${id}"[^>]*\\spopover="auto"[^>]*>([\\s\\S]*?)</div>`))
      expect(pop, id).not.toBeNull()
      const text = textOf(pop![1])
      if (note === undefined) {
        expect(text, id).toContain(v === 'default' ? 'with no options set' : 'no option of its own')
        continue
      }
      for (const u of note.match(/https?:\/\/[^\s),]+/g) ?? []) expect(pop![1], id).toContain(`href="${u}"`)
      for (const piece of note.split(/https?:\/\/[^\s),]+/)) {
        const words = piece.replaceAll('`', '').replace(/\s+/g, ' ').trim()
        if (words) expect(text, id).toContain(words)
      }
    }
    // Every cell opens a note that exists.
    for (const [, target] of html().matchAll(/\spopovertarget="([^"]+)"/g)) expect(html()).toContain(`id="${target}"`)
  })

  it('counts the cells that needed hand-written code, per library and setup', () => {
    for (const v of VARIANTS) {
      const sentence = fact(`code-count-${v}`)
      for (const n of LIBRARIES) {
        const count = data.scenarios.filter((s: any) => cell(s, n, v).kind === 'code').length
        expect(sentence, `${v} ${n}`).toMatch(new RegExp(`\\b${n} ${count}\\b`))
      }
    }
    const rows = data.scenarios.filter((s: any) => cell(s, 'liaise', 'configured').kind === 'code').map((s: any) => s.title)
    expect(fact('liaise-code')).toContain(`liaise needed it only in ${list(rows.map((t: string) => `“${t}”`))}`)
    const throws = data.scenarios.some((s: any) => VARIANTS.some(v => /(?:^|: )throws\b/.test(outcome(s.id, 'liaise', v))))
    expect(fact('liaise-code').includes('No liaise cell throws')).toBe(!throws)
  })

  it('says which libraries refuse an undefined path param before sending', () => {
    const refusers = LIBRARIES.filter(n => /^refused before sending/.test(outcome('missing-param', n, 'configured')))
    expect(refusers.length).toBeGreaterThan(0)
    expect(fact('path-param')).toBe(refusers.length === 1
      ? `${refusers[0]} is the only one that refuses an undefined path param before sending the request.`
      : `${list(refusers)} refuse an undefined path param before sending the request.`)
  })

  it('renders the size table, and where liaise places in it', () => {
    for (const n of [...NAMES, 'liaise + retryMiddleware']) {
      const row = html().match(new RegExp(`<tr[^>]*\\sdata-size="${escapeRe(n)}"[^>]*>([\\s\\S]*?)</tr>`))
      expect(row, n).not.toBeNull()
      expect(textOf(row![1])).toBe(`${n === 'fetch' ? 'plain fetch (baseline)' : n}${kb(data.sizes[n].gzip)}${kb(data.sizes[n].brotli)}`)
    }
    const place = (m: 'gzip' | 'brotli') => {
      const by = (a: string, b: string) => data.sizes[a][m] - data.sizes[b][m]
      const smaller = libraries.filter(n => data.sizes[n][m] < data.sizes.liaise[m]).sort(by)
      const larger = libraries.filter(n => data.sizes[n][m] > data.sizes.liaise[m]).sort(by)
      return [smaller.length ? `larger than ${list(smaller)}` : '', larger.length ? `smaller than ${list(larger)}` : ''].filter(Boolean).join(' and ')
    }
    expect(fact('size-place')).toBe(place('gzip') === place('brotli')
      ? `Gzipped or brotli-compressed, liaise is ${place('gzip')}.`
      : `Gzipped, liaise is ${place('gzip')}. Brotli-compressed, it is ${place('brotli')}.`)
    const src = readFileSync(new URL('../../compare/sizes.mjs', import.meta.url), 'utf8')
    expect(src).toContain("target: 'es2020', platform: 'browser'")
    expect(fact('size-method')).toContain('minified ES2020 ESM bundle for a browser')
    expect(fact('size-baseline')).toMatch(/^Plain fetch is the baseline, not a library/)
  })

  it('renders requests per second, and how liaise compares in each mode', () => {
    const fmt = (x: any) => `${x.median.toLocaleString('en-US')} (${x.min.toLocaleString('en-US')}–${x.max.toLocaleString('en-US')})`
    for (const n of NAMES) {
      const row = html().match(new RegExp(`<tr[^>]*\\sdata-rps="${n}"[^>]*>([\\s\\S]*?)</tr>`))
      expect(row, n).not.toBeNull()
      expect(textOf(row![1])).toBe(`${n === 'fetch' ? 'plain fetch (baseline)' : n}${fmt(data.overhead[n].sequential)}${fmt(data.overhead[n].concurrent)}`)
    }
    for (const mode of MODES) {
      const base = data.overhead.liaise[mode].median
      const rel = others.map(n => ({ n, d: (data.overhead[n][mode].median - base) / base }))
      const ties = rel.filter(r => Math.abs(r.d) < OVERHEAD.noise).map(r => r.n)
      const sentence = fact(`overhead-${mode}`)
      if (ties.length) expect(sentence, mode).toMatch(new RegExp(`liaise ties ${list(ties.map(display))}[;.]`))
      for (const r of rel.filter(r => Math.abs(r.d) >= OVERHEAD.noise))
        expect(sentence, `${mode} ${r.n}`).toMatch(new RegExp(`(^|[;,] )${display(r.n)} (handles )?about ${Math.round(Math.abs(r.d) * 100)}% ${r.d > 0 ? 'more' : 'fewer'}\\b`))
    }
  })

  it('describes the overhead run as compare/overhead.mjs runs it', () => {
    const src = readFileSync(new URL('../../compare/overhead.mjs', import.meta.url), 'utf8')
    const constant = (name: string) => Number(src.match(new RegExp(`\\b${name} = (\\d+)`))?.[1])
    expect(OVERHEAD).toMatchObject({ rounds: constant('RUNS'), calls: constant('CALLS'), inFlight: constant('POOL'), warmup: constant('WARMUP') })
    const method = fact('overhead-method')
    expect(method).toContain(`${OVERHEAD.rounds} interleaved rounds of ${OVERHEAD.calls.toLocaleString('en-US')} calls each, after ${OVERHEAD.warmup.toLocaleString('en-US')} warm-up calls`)
    expect(method).toContain(data.meta.overheadNote)
    expect(method).toContain(`under about ${OVERHEAD.noise * 100}% are noise`)
    expect(html()).toContain(`${OVERHEAD.inFlight} in flight`)
    expect(fact('rps-baseline')).toMatch(/^Plain fetch is the baseline/)
  })

  it('lists where liaise loses, each item from the data', () => {
    // No default timeout: a hung server leaves liaise waiting; who does time out.
    expect(outcome('hang', 'liaise', 'default')).toMatch(/^still waiting/)
    const timesOut = libraries.filter(n => /(?:^|: )(throws|error result)\b/.test(outcome('hang', n, 'default')))
    const t = fact('loses-timeout')
    expect(t).toContain(outcome('hang', 'liaise', 'default'))
    expect(t).toContain(timesOut.length === 1 ? `Only ${timesOut[0]} times out by default` : `${list(timesOut)} time out by default`)
    expect(t).toContain(`“${outcome('hang', 'liaise', 'configured')}”`)

    // A 204 on a JSON call: liaise's own outcome, and what the others do.
    const e = fact('loses-204')
    expect(e).toContain(`“${outcome('empty-204', 'liaise', 'default')}”`)
    const throwers = libraries.filter(n => /^throws/.test(outcome('empty-204', n, 'default')))
    const resolvers = libraries.filter(n => /^resolves/.test(outcome('empty-204', n, 'default')))
    expect(e).toMatch(new RegExp(`[;,] ${list(throwers)} throws?[;.]`))
    expect(e).toMatch(new RegExp(`[;,] ${list(resolvers)} resolves?[;.]`))

    // No retries out of the box: attempts in the deadline row.
    const attempts = (n: string) => Number(outcome('deadline', n, 'default').match(/(\d+) attempts?/)![1])
    const retriers = libraries.filter(n => attempts(n) > attempts('liaise'))
    const r = fact('loses-retries')
    for (const n of [...retriers, 'liaise']) expect(r).toMatch(new RegExp(`\\b${n}( made)? ${attempts(n)}\\b`))

    // Larger than: every library smaller than liaise, with both sizes.
    const smaller = libraries.filter(n => data.sizes[n].gzip < data.sizes.liaise.gzip)
    const s = fact('loses-size')
    for (const n of smaller) expect(s).toContain(`${n} ${kb(data.sizes[n].gzip)} kB`)
    expect(s).toContain(`liaise is ${kb(data.sizes.liaise.gzip)} kB`)

    // Request overhead: a library, or the plain-fetch baseline, ahead of liaise by more than the noise.
    for (const mode of MODES) {
      const base = data.overhead.liaise[mode].median
      for (const n of others) {
        const d = (data.overhead[n][mode].median - base) / base
        if (d < OVERHEAD.noise) continue
        const item = fact(`loses-overhead-${mode}`)
        expect(item).toContain(`${display(n)} handles about ${Math.round(d * 100)}% more requests per second than liaise`)
        if (n === 'fetch') expect(item).toMatch(/^Fewer requests per second than (.*, )?the plain fetch baseline\./)
      }
    }
  })

  it('says when a library or the baseline ahead of liaise has a min–max range that overlaps liaise’s', () => {
    for (const mode of MODES) {
      const L = data.overhead.liaise[mode]
      const ahead = others.filter(n => (data.overhead[n][mode].median - L.median) / L.median >= OVERHEAD.noise)
      if (!ahead.length) continue
      const sentence = fact(`loses-overhead-${mode}`)
      for (const n of ahead) {
        const overlaps = data.overhead[n][mode].min <= L.max && L.min <= data.overhead[n][mode].max
        const pctAhead = Math.round(((data.overhead[n][mode].median - L.median) / L.median) * 100)
        const claim = `${display(n)} handles about ${pctAhead}% more requests per second than liaise`
        expect(sentence, `${mode} ${n}`).toContain(claim)
        expect(sentence.includes(`${claim} (the ranges overlap)`), `${mode} ${n} overlap`).toBe(overlaps)
      }
    }
  })

  it('compares ky with liaise row by row, from the data', () => {
    const norm = (o: string) => o.replace(/throws [^,]+|error result \([^)]*\)/g, 'ERR')
    const code = (s: any, n: string) => cell(s, n, 'configured').kind === 'code'
    const differs = (n: string) => data.scenarios.filter((s: any) =>
      norm(outcome(s.id, n, 'configured')) !== norm(outcome(s.id, 'liaise', 'configured')) || code(s, n) !== code(s, 'liaise'))
    const ky = differs('ky')
    // "Closest" holds only while ky differs from liaise in fewer rows than any other library.
    for (const n of libraries.filter(n => n !== 'ky')) expect(differs(n).length, n).toBeGreaterThan(ky.length)
    expect(fact('ky-rows')).toContain(`in ${ky.length} of the ${data.scenarios.length} rows`)
    const shown = [...html().matchAll(/\sdata-ky-row="([^"]+)"/g)].map(m => m[1])
    expect(shown).toEqual(ky.map((s: any) => s.id))

    const timesOut = libraries.filter(n => /(?:^|: )(throws|error result)\b/.test(outcome('hang', n, 'default')))
    expect(timesOut).toEqual(['ky'])
    expect(fact('ky-defaults')).toContain('only ky times out')
    expect(fact('ky-size')).toBe(`ky is ${kb(data.sizes.ky.gzip)} kB gzipped, liaise ${kb(data.sizes.liaise.gzip)} kB.`)
  })

  it('links each scenario title to its guide page, and every link resolves', () => {
    const guide: Record<string, string> = {
      hang: '/guide/cancelling-deadlines-and-stale-requests/', deadline: '/guide/cancelling-deadlines-and-stale-requests/',
      'refresh-stampede': '/recipes/add-an-auth-header-and-refresh-the-token-on-a-401/', 'search-race': '/recipes/search-as-you-type/',
      'missing-param': '/guide/defining-endpoints/', 'wrong-shape': '/guide/validating-responses/',
    }
    for (const s of data.scenarios) {
      const links = [...html().matchAll(new RegExp(`<a href="([^"]+)"[^>]*\\sdata-scenario="${s.id}"`, 'g'))].map(m => m[1])
      expect(links.length, s.id).toBeGreaterThan(0)
      for (const l of links) expect(l, s.id).toBe(`/liaise${guide[s.id] ?? '/guide/handling-errors/'}`)
    }
    const internal = new Set([...html().matchAll(/<a href="(\/liaise\/[^"#]*)(#[^"]*)?"/g)].map(m => [m[1], m[2]] as const).map(([p, h]) => `${p}${h ?? ''}`))
    for (const href of internal) {
      const [path, anchor] = href.split('#')
      expect(existsSync(distPage(path)), href).toBe(true)
      if (anchor) expect(readFileSync(distPage(path), 'utf8'), href).toContain(`id="${anchor}"`)
    }
  })

  it('says which liaise it measured when that is not the current release', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    const measured = data.meta.versions.liaise
    if (measured === pkg.version) expect(html()).not.toContain('data-fact="liaise-version"')
    else expect(fact('liaise-version')).toBe(`This run measured liaise ${measured}; the current release is ${pkg.version}.`)
  })

  it('is the Compare section in the header, which links here', () => {
    expect(html()).toMatch(/<a href="\/liaise\/compare\/"[^>]*\saria-current="true"[^>]*>Compare<\/a>/)
    const doc = readFileSync(distPage('/liaise/choosing/how-it-compares/'), 'utf8')
    expect(doc).toMatch(/<a href="\/liaise\/compare\/"(?![^>]*aria-current)[^>]*>Compare<\/a>/)
    expect(doc).toMatch(/<a href="\/liaise\/start\/quick-start\/"[^>]*\saria-current="true"[^>]*>Docs<\/a>/)
  })
})
