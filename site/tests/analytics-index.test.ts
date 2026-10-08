import { describe, it, expect, vi, afterEach } from 'vitest'

// A small fake browser: just enough of window, document, navigator and fetch for the collector.
interface Env { gpc?: boolean; webdriver?: boolean; ua?: string; host?: string; noCrypto?: boolean; search?: string; referrer?: string }
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

function fakeBrowser(env: Env = {}) {
  const win = new EventTarget()
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const input = new EventTarget()
  const anchors = [{ id: 'a1' }, { id: 'a2' }]
  const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}')))
  // The search list as Base.astro leaves it: empty, and no data-q, until Pagefind's results are shown.
  const list = { dataset: {} as Record<string, string> }
  const query: Record<string, unknown[]> = { '#search-results > li > a': [], '#search-results a': [] }
  Object.assign(doc, {
    referrer: env.referrer ?? '',
    getElementById: (id: string) => (id === 'search-input' ? input : null),
    querySelector: (sel: string) => (sel === '#search-results' ? list : sel === '#search-results a[data-active="true"]' ? anchors[1] : null),
    querySelectorAll: (sel: string) => query[sel] ?? [],
  })
  const replaceState = vi.fn()
  vi.stubGlobal('history', { state: null, replaceState })
  vi.stubGlobal('addEventListener', win.addEventListener.bind(win))
  vi.stubGlobal('dispatchEvent', win.dispatchEvent.bind(win))
  vi.stubGlobal('document', doc)
  vi.stubGlobal('location', { hostname: env.host ?? 'iremlopsum.github.io', pathname: '/start/quick-start/', search: env.search ?? '', hash: '#install', origin: `https://${env.host ?? 'iremlopsum.github.io'}`, href: `https://${env.host ?? 'iremlopsum.github.io'}/start/quick-start/${env.search ?? ''}#install` })
  vi.stubGlobal('navigator', { userAgent: env.ua ?? UA, language: 'en-GB', webdriver: env.webdriver ?? false, globalPrivacyControl: env.gpc ?? false })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('innerWidth', 1280)
  vi.stubGlobal('fetch', fetchSpy)
  if (env.noCrypto) vi.stubGlobal('crypto', undefined)
  const fire = (target: EventTarget, type: string, props: object = {}) => target.dispatchEvent(Object.defineProperties(new Event(type), Object.fromEntries(Object.entries(props).map(([k, v]) => [k, { value: v }]))))
  return {
    fetchSpy, win, doc, input, anchors, replaceState,
    /** Base.astro shows the results for `q`: the two anchors, or No results. */
    results(q: string, n = anchors.length) { list.dataset.q = q; query['#search-results > li > a'] = query['#search-results a'] = anchors.slice(0, n) },
    hide() { doc.visibilityState = 'hidden'; fire(doc, 'visibilitychange') },
    show() { doc.visibilityState = 'visible'; fire(doc, 'visibilitychange') },
    pagehide() { fire(win, 'pagehide') },
    fire,
    bodies: () => (fetchSpy.mock.calls as unknown as Array<[string, { body: string }]>).map((c) => JSON.parse(c[1].body)),
  }
}
// Wrapped: the no-op is a Proxy that answers every property, `then` included, so awaiting it would hang.
const load = async () => { vi.resetModules(); const { analytics } = await import('../src/analytics/index'); return { a: analytics } }
const link = (href: unknown) => { const l: any = { href }; l.closest = (sel: string) => (sel === 'a[href]' ? l : null); return l }
const idOf = (b: any) => String(b.writes[0].update.name).split('/pv/')[1] as string

afterEach(() => { vi.unstubAllGlobals() })

describe('the collector gate', () => {
  const cases: Array<[string, Env]> = [
    ['Global Privacy Control', { gpc: true }],
    ['an automated browser', { webdriver: true }],
    ['a bot User-Agent', { ua: 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/130.0' }],
    ['another host', { host: 'example.com' }],
  ]
  for (const [name, env] of cases)
    it(`sends nothing on ${name}`, async () => {
      const b = fakeBrowser(env)
      const { a } = await load()
      expect(() => { a.copy('install', true); a.tab('x'); a.input() }).not.toThrow()
      b.hide(); b.pagehide()
      expect(b.fetchSpy).not.toHaveBeenCalled()
    })
})

describe('the collector in an enabled page', () => {
  it('sends exactly one commit on a hide followed by a pagehide, for pv/<pv>-1', async () => {
    const b = fakeBrowser()
    await load()
    b.hide(); b.pagehide()
    expect(b.fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = b.fetchSpy.mock.calls[0] as unknown as [string, { method: string; keepalive: boolean }]
    expect(url).toContain(':commit?key=')
    expect(init).toMatchObject({ method: 'POST', keepalive: true })
    expect(idOf(b.bodies()[0])).toMatch(/^[a-z0-9]{12}-1$/)
  })

  it('a page restored from the back/forward cache is a new page view: new pv, seq 1', async () => {
    const b = fakeBrowser()
    const { a } = await load()
    for (let i = 0; i < 5; i++) { a.tab('t' + i); b.pagehide() }
    a.tab('more'); b.pagehide()
    expect(b.fetchSpy).toHaveBeenCalledTimes(5) // capped
    const first = idOf(b.bodies()[0]).split('-')[0]
    b.fire(b.win, 'pageshow', { persisted: true })
    b.hide()
    expect(b.fetchSpy).toHaveBeenCalledTimes(6)
    const last = idOf(b.bodies()[5])
    expect(last).toMatch(/-1$/)
    expect(last.split('-')[0]).not.toBe(first)
  })

  it('a collector that fails to start (no crypto) exports a working no-op', async () => {
    const b = fakeBrowser({ noCrypto: true })
    const { a } = await load()
    expect(() => { a.copy('install', true); a.slideShown(0); a.input() }).not.toThrow()
    b.hide(); b.pagehide()
    expect(b.fetchSpy).not.toHaveBeenCalled()
  })

  it('a click on an unparseable link, or on an SVG anchor, throws nothing', async () => {
    const b = fakeBrowser()
    await load()
    const bad = link('http://[')
    const svg = link({ baseVal: '/x' })
    expect(() => { b.fire(b.doc, 'click', { target: bad }); b.fire(b.doc, 'click', { target: svg }) }).not.toThrow()
    b.hide()
    expect(b.fetchSpy).toHaveBeenCalledTimes(1) // and the collector still works
  })

  it('a link to a #hash on the same page is not navigation: the visit still counts as an exit', async () => {
    const b = fakeBrowser()
    await load()
    const toc = link('https://iremlopsum.github.io/start/quick-start/#install')
    b.fire(b.doc, 'click', { target: toc })
    b.hide()
    expect(b.bodies()[0].writes[0].update.fields.x.booleanValue).toBe(true)
  })

  it('a query typed less than 1 s before the tab is hidden is still recorded', async () => {
    const b = fakeBrowser()
    await load()
    b.fire(b.doc, 'input', { target: { id: 'search-input', value: 'dedupe' } })
    b.results('dedupe')
    b.hide()
    expect(b.bodies()[0].writes[0].update.fields.se.stringValue).toBe('dedupe:2:-')
  })

  it('Enter on the highlighted result records the click position and that the visit did not exit', async () => {
    const b = fakeBrowser()
    await load()
    b.fire(b.doc, 'input', { target: { id: 'search-input', value: 'dedupe' } })
    b.results('dedupe')
    b.fire(b.input, 'keydown', { key: 'Enter' })
    b.hide()
    const f = b.bodies()[0].writes[0].update.fields
    expect(f.se.stringValue).toBe('dedupe:2:2')
    expect(f.x.booleanValue).toBe(false)
  })
})

describe('a slow first search', () => {
  // Pagefind loads on the first search, which can take seconds: the list says which query it shows.
  const se = (b: ReturnType<typeof fakeBrowser>, k: number) => b.bodies()[k].writes[0].update.fields.se.stringValue
  afterEach(() => { vi.useRealTimers() })

  it('results that arrive after the reader stopped typing are counted as they are', async () => {
    vi.useFakeTimers()
    const b = fakeBrowser()
    await load()
    b.fire(b.doc, 'input', { target: { id: 'search-input', value: 'dedupe' } })
    vi.advanceTimersByTime(1000 + 2500) // the reader stopped typing; no results yet
    b.results('dedupe')
    vi.advanceTimersByTime(500)
    b.hide()
    expect(se(b, 0)).toBe('dedupe:2:-')
  })

  it('results for an earlier query are not this one\'s count', async () => {
    vi.useFakeTimers()
    const b = fakeBrowser()
    await load()
    b.results('dedupe')
    b.fire(b.doc, 'input', { target: { id: 'search-input', value: 'dedupe share' } })
    vi.advanceTimersByTime(1500)
    b.results('dedupe share', 0)
    vi.advanceTimersByTime(500)
    b.hide()
    expect(se(b, 0)).toBe('dedupe share:0:-')
  })

  it('a result picked while newer typing has no results yet counts for the query it was shown for', async () => {
    const b = fakeBrowser()
    await load()
    b.fire(b.doc, 'input', { target: { id: 'search-input', value: 'dedupe' } })
    b.results('dedupe')
    b.fire(b.doc, 'input', { target: { id: 'search-input', value: 'dedupe sh' } })
    b.fire(b.input, 'keydown', { key: 'Enter' })
    b.hide()
    expect(se(b, 0)).toBe('dedupe:2:2')
  })

  it('a hide before any results arrive records nothing for that query, and a later count is the real one', async () => {
    vi.useFakeTimers()
    const b = fakeBrowser()
    await load()
    b.fire(b.doc, 'input', { target: { id: 'search-input', value: 'dedupe' } })
    vi.advanceTimersByTime(1500)
    b.hide()
    expect(se(b, 0)).toBe('')
    b.results('dedupe')
    vi.advanceTimersByTime(500)
    b.pagehide()
    expect(se(b, 1)).toBe('dedupe:2:-')
  })

  it('a page closed before any results arrive records nothing for that query', async () => {
    const b = fakeBrowser()
    await load()
    b.fire(b.doc, 'input', { target: { id: 'search-input', value: 'dedupe' } })
    b.pagehide()
    expect(se(b, 0)).toBe('')
  })

  it('stops looking after 5 s: results that never come record nothing', async () => {
    vi.useFakeTimers()
    const b = fakeBrowser()
    await load()
    b.fire(b.doc, 'input', { target: { id: 'search-input', value: 'dedupe' } })
    vi.advanceTimersByTime(1000 + 5000)
    expect(vi.getTimerCount()).toBe(0)
    b.hide()
    expect(se(b, 0)).toBe('')
  })
})

describe('a returning visitor sent on from the front page', () => {
  it('keeps the site they came from and their tags, and the address bar loses the marker', async () => {
    const b = fakeBrowser({ search: '?via=front&r=https%3A%2F%2Fgithub.com&utm_source=newsletter', referrer: 'https://iremlopsum.github.io/liaise/' })
    await load()
    b.hide()
    const f = b.bodies()[0].writes[0].update.fields
    // An outside origin, not a path of this site: the dashboard counts the view as an entry from GitHub.
    expect(f.f.stringValue).toBe('https://github.com')
    expect(f.tg.mapValue.fields.utm_source.stringValue).toBe('newsletter')
    expect(b.replaceState).toHaveBeenCalledWith(null, '', '/start/quick-start/?utm_source=newsletter#install')
  })

  it('without r, or with an r that is not an origin, the visit is direct', async () => {
    for (const search of ['?via=front', '?via=front&r=%2Fcompare%2F', '?via=front&r=javascript%3Aalert(1)']) {
      const b = fakeBrowser({ search, referrer: 'https://iremlopsum.github.io/liaise/' })
      await load()
      b.hide()
      expect(b.bodies()[0].writes[0].update.fields.f.stringValue, search).toBe('')
      expect(b.replaceState, search).toHaveBeenCalledWith(null, '', '/start/quick-start/#install')
      vi.unstubAllGlobals()
    }
  })

  it('an address without the marker is left alone', async () => {
    const b = fakeBrowser({ search: '?utm_source=newsletter', referrer: 'https://news.ycombinator.com/' })
    await load()
    b.hide()
    expect(b.bodies()[0].writes[0].update.fields.f.stringValue).toBe('https://news.ycombinator.com')
    expect(b.replaceState).not.toHaveBeenCalled()
  })
})
