import { describe, it, expect } from 'vitest'
import {
  CAPS, RX, STEP_NAMES, encodeRecord, decodeWire, toFields, cleanQuery, cleanPath, cleanTag,
  emptyIntro, emptyStep10, type PageRecord,
} from '../src/analytics/schema'

const base = (): PageRecord => ({
  v: 1, pv: 'abcdef123456', seq: 1, path: '/start/quick-start/', tags: { ref: 'readme' }, from: 'https://news.ycombinator.com',
  tz: 'Europe/Tallinn', lang: 'et-ee', browser: 'chrome', os: 'macos', device: 'desktop', exit: true, engagedMs: 12_000,
  searches: [], copies: [], out: { github: 0, npm: 0, compare: 0 }, tabs: [], runs: [], editorFailed: false, intro: null,
})
const re = (k: keyof typeof RX) => new RegExp(RX[k])

describe('analytics schema', () => {
  it('round-trips a full record through the wire form', () => {
    const r = base()
    r.searches = [{ q: 'axios interceptors', n: 0, pos: null }, { q: 'dedupe', n: 4, pos: 1 }]
    r.copies = [{ block: 'install', ok: true }, { block: '/start/quick-start/#2', ok: false }]
    r.out = { github: 1, npm: 0, compare: 2 }
    r.tabs = ['quick-start', 'search']
    r.runs = [{ tab: 'search', edited: true, typeErrors: 2, threw: false }]
    const intro = emptyIntro()
    intro.start = { method: 'enter', ms: 6400, prefetched: true }
    intro.slides[0] = { reached: true, ended: true, ms: 31_200, pauses: 1, replays: 0, seeks: 2, back: 0, jumps: 0, copies: 1, copyFails: 0 }
    intro.furthest = 10
    intro.skipFrom = ''
    intro.step10 = { ...emptyStep10(), editor: 'loaded', loadMs: 1800, runs: { healthy: 3, down: 1, slow: 0 },
      attempts: [{ pass: [true, true, false, true, true], reason: 'http' }, { pass: [true, true, true, true, true], reason: null }],
      solution: false, startOver: true, drawer: true, passMs: 252_000, outcome: 'docs' }
    r.intro = intro
    expect(decodeWire(encodeRecord(r))).toEqual(r)
  })

  it('applies every cap', () => {
    const r = base()
    r.searches = Array.from({ length: 25 }, (_, i) => ({ q: `q${i}`, n: 1, pos: null }))
    r.copies = Array.from({ length: 35 }, () => ({ block: 'install', ok: true }))
    r.tabs = Array.from({ length: 25 }, () => 'retry')
    r.runs = Array.from({ length: 55 }, () => ({ tab: 'retry', edited: false, typeErrors: 0, threw: false }))
    const w = encodeRecord(r)
    expect(w.se.split(',')).toHaveLength(CAPS.searches)
    expect(w.cp.split(',')).toHaveLength(CAPS.copies)
    expect(w.tb.split(',')).toHaveLength(CAPS.tabs)
    expect(w.ru.split(',')).toHaveLength(CAPS.runs)
  })

  it('pads short slide and check lists, and drops an out-of-range skip step', () => {
    const r = base()
    r.intro = emptyIntro()
    r.intro.slides = r.intro.slides.slice(0, 3)
    r.intro.step10 = { ...emptyStep10(), attempts: [{ pass: [true, false, true], reason: null }] }
    const w = encodeRecord(r)
    expect(w.it!.sl).toMatch(re('slides'))
    expect(w.it!.t!.at).toMatch(re('attempts'))
    expect(decodeWire(w)).not.toBeNull()
  })

  it.each([0, 11, NaN, 2.5])('drops skipFrom %s instead of sending it', (skip) => {
    const r = base()
    r.intro = emptyIntro()
    r.intro.skipFrom = skip as number
    const w = encodeRecord(r)
    expect(w.it!.sk).toBe('')
    expect(decodeWire(w)).not.toBeNull()
  })

  it('every string field it produces matches its regex, at the caps', () => {
    const r = base()
    r.path = '/' + 'a'.repeat(200)
    r.searches = Array.from({ length: CAPS.searches }, () => ({ q: 'x'.repeat(100), n: 99_999, pos: 120 }))
    r.copies = Array.from({ length: CAPS.copies }, () => ({ block: '/' + 'b'.repeat(200) + '#9999', ok: true }))
    r.runs = Array.from({ length: CAPS.runs }, () => ({ tab: 'every-failure', edited: true, typeErrors: 500, threw: true }))
    r.intro = emptyIntro()
    r.intro.step10 = { ...emptyStep10(), attempts: Array.from({ length: CAPS.attempts }, () => ({ pass: [false, false, false, false, false], reason: 'undefined' })) }
    const w = encodeRecord(r)
    expect(w.p).toMatch(re('path'))
    expect(w.se).toMatch(re('searches'))
    expect(w.cp).toMatch(re('copies'))
    expect(w.ru).toMatch(re('runs'))
    expect(w.it!.sl).toMatch(re('slides'))
    expect(w.it!.t!.at).toMatch(re('attempts'))
  })

  it('cleans what visitors type and what URLs carry', () => {
    expect(cleanQuery('  Axios, Interceptors: 2!  ')).toBe('axios interceptors 2')
    expect(cleanQuery('x'.repeat(80))).toHaveLength(CAPS.query)
    expect(cleanPath('/Guide/Handling Errors/?a=1')).toBe('/guide/handling-errors/-a-1')
    expect(cleanTag('News Letter!')).toBe('news-letter-')
  })

  it('decodes only what the rules would accept', () => {
    const w = encodeRecord(base()) as unknown as Record<string, unknown>
    expect(decodeWire({ ...w, v: 2 })).toBeNull()
    expect(decodeWire({ ...w, br: 'netscape' })).toBeNull()
    expect(decodeWire({ ...w, se: 'not:a:search:at:all' })).toBeNull()
    expect(decodeWire(null)).toBeNull()
  })

  it('encodes Firestore REST typed values: strings, integers as strings, booleans, nested maps', () => {
    expect(toFields({ a: 'x', b: 3, c: true, d: { e: 1 } })).toEqual({
      a: { stringValue: 'x' }, b: { integerValue: '3' }, c: { booleanValue: true },
      d: { mapValue: { fields: { e: { integerValue: '1' } } } },
    })
  })

  it('names the ten steps', () => {
    expect(STEP_NAMES).toHaveLength(10)
    expect(STEP_NAMES[3]).toBe('Share')
  })
})
