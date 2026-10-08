import { describe, it, expect, vi } from 'vitest'
import { createRecorder } from '../src/analytics/recorder'
import { createEngagement, IDLE_MS } from '../src/analytics/engaged'
import { createFlusher, RESEND_MS } from '../src/analytics/flush'
import { browserOf, osOf, deviceOf, BOT } from '../src/analytics/ua'
import { pagePath, fromOf, tagsOf, randomId } from '../src/analytics/page'
import { post } from '../src/analytics/send'

const init = { pv: 'abcdef123456', path: '/', tags: {}, from: '', tz: 'UTC', lang: 'en', browser: 'chrome' as const, os: 'macos' as const, device: 'desktop' as const }
function clock(t = 0) { const c = { t, now: () => c.t }; return c }

describe('recorder', () => {
  it('keeps the furthest step, times slides only while shown and visible, and knows where a skip came from', () => {
    const c = clock()
    const r = createRecorder(init, c.now)
    r.introShown()
    r.skip()
    r.slideShown(0); c.t += 10_000
    r.visibility(false); c.t += 50_000; r.visibility(true); c.t += 5_000
    r.slideShown(3); c.t += 2_000
    r.step10Shown(); c.t += 1_000
    const s = r.snapshot(1, 0)
    expect(s.intro!.skipFrom).toBe('start')
    expect(s.intro!.slides[0].ms).toBe(15_000)
    expect(s.intro!.slides[3].ms).toBe(2_000)
    expect(s.intro!.furthest).toBe(10)
  })
  it('records step 10: attempts, time from first edit to passing, and the outcome', () => {
    const c = clock()
    const r = createRecorder(init, c.now)
    r.step10Shown(); r.editor('loaded', 1800); r.run10('down')
    r.firstEdit(); c.t += 90_000
    r.attempt([true, true, false, true, true], 'http')
    r.attempt([true, true, true, true, true], null); r.passed(); r.outcome('docs')
    const t = r.snapshot(1, 0).intro!.step10!
    expect(t).toMatchObject({ editor: 'loaded', loadMs: 1800, runs: { healthy: 0, down: 1, slow: 0 }, passMs: 90_000, outcome: 'docs' })
    expect(t.attempts).toHaveLength(2)
  })
  it('updates the last search when its result is clicked, instead of adding one', () => {
    const r = createRecorder(init, () => 0)
    r.search('dedupe', 4, null)
    r.searchClick('dedupe', 2)
    expect(r.snapshot(1, 0).searches).toEqual([{ q: 'dedupe', n: 4, pos: 2 }])
  })
  it('is dirty until sent, then only after a change; an internal link click means no exit', () => {
    const r = createRecorder(init, () => 0)
    expect(r.dirty).toBe(true)
    r.snapshot(1, 0)
    expect(r.dirty).toBe(false)
    r.internalLink()
    expect(r.dirty).toBe(true)
    expect(r.snapshot(2, 0).exit).toBe(false)
  })
})

describe('engaged time', () => {
  it('counts visible time with input in the last 15 s, nothing while hidden or idle', () => {
    const c = clock()
    const e = createEngagement(c.now)
    c.t += 5_000; e.input()
    c.t += IDLE_MS + 10_000           // 15 s of it count, then idle
    expect(e.ms).toBe(5_000 + IDLE_MS)
    e.input(); e.setVisible(false); c.t += 60_000; e.setVisible(true)
    expect(e.ms).toBe(5_000 + IDLE_MS)
  })
})

describe('send policy', () => {
  it('sends on the first hide, not again on the pagehide right after, then waits 30 s for a change', () => {
    const c = clock(1_000)
    let dirty = true
    const sent: number[] = []
    const f = createFlusher({ now: c.now, dirty: () => dirty, send: (seq) => { sent.push(seq); dirty = false } })
    f.hidden(); f.pagehide()
    expect(sent).toEqual([1])
    dirty = true; c.t += 10_000; f.hidden()
    expect(sent).toEqual([1])
    c.t += RESEND_MS; f.hidden()
    expect(sent).toEqual([1, 2])
    dirty = true; f.pagehide()
    expect(sent).toEqual([1, 2, 3])
  })
  it('never sends more than 5 times', () => {
    const c = clock()
    const sent: number[] = []
    const f = createFlusher({ now: c.now, dirty: () => true, send: (seq) => sent.push(seq) })
    for (let i = 0; i < 9; i++) { c.t += RESEND_MS; f.hidden(); f.pagehide() }
    expect(sent).toEqual([1, 2, 3, 4, 5])
  })
})

describe('page and browser facts', () => {
  it('turns a User-Agent into categories', () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
    const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0'
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1'
    expect([browserOf(mac), osOf(mac), deviceOf(1440, mac, false)]).toEqual(['safari', 'macos', 'desktop'])
    expect([browserOf(edge), osOf(edge)]).toEqual(['edge', 'windows'])
    expect([browserOf(iphone), osOf(iphone), deviceOf(390, iphone, true)]).toEqual(['chrome', 'ios', 'phone'])
    expect(deviceOf(1024, mac, true)).toBe('tablet') // iPadOS says Macintosh
    expect(BOT.test('Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/130.0')).toBe(true)
  })
  it('reads the path under the base, the referrer as an origin or own path, and only the four tags', () => {
    expect(pagePath('/liaise/start/quick-start/', '/liaise/')).toBe('/start/quick-start/')
    expect(pagePath('/liaise/', '/liaise/')).toBe('/')
    expect(fromOf('https://news.ycombinator.com/item?id=1', 'https://iremlopsum.github.io', '/liaise/')).toBe('https://news.ycombinator.com')
    expect(fromOf('https://iremlopsum.github.io/liaise/compare/', 'https://iremlopsum.github.io', '/liaise/')).toBe('/compare/')
    expect(fromOf('', 'https://iremlopsum.github.io', '/liaise/')).toBe('')
    expect(tagsOf('?ref=readme&utm_source=News&gclid=x')).toEqual({ ref: 'readme', utm_source: 'news' })
    expect(randomId()).toMatch(/^[a-z0-9]{12}$/)
  })
  it('a fetch that throws, or rejects, never escapes post()', async () => {
    expect(() => post('x', '{}', (() => { throw new Error('no') }) as never)).not.toThrow()
    expect(() => post('x', '{}', (() => Promise.reject(new Error('offline'))) as never)).not.toThrow()
    await new Promise((r) => setTimeout(r, 0)) // an unhandled rejection would fail the run here
  })
})

describe('never breaks the page', () => {
  it('a collector that throws doesn\'t break the page: the module still exports a working no-op', async () => {
    vi.resetModules()
    vi.stubGlobal('navigator', { get userAgent(): string { throw new Error('boom') } })
    const { analytics } = await import('../src/analytics/index')
    expect(() => { analytics.copy('install', true); analytics.slideShown(0); analytics.input() }).not.toThrow()
    vi.unstubAllGlobals()
  })
})
