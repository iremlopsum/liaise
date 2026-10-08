// One analytics record per page view (docs/superpowers/specs/2026-10-08-cookieless-analytics-design.md
// §3). The collector builds a PageRecord, sends its Wire form, and the dashboard decodes the Wire
// back. firestore.rules checks the Wire with the same regexes (RX). Change a cap or a pattern here,
// and dashboard/tests/emu/rules.test.ts says whether the rules still agree.
//
// Lists travel as one compact string each (entries joined by ",", fields by ":"), because Firestore
// rules can't loop over a list: one regex bounds a whole list, item by item.

export const SCHEMA_VERSION = 1
export const CAPS = { searches: 20, copies: 30, tabs: 20, runs: 50, attempts: 20, sends: 5, query: 60, path: 120, tag: 40 } as const
export const BROWSERS = ['chrome', 'safari', 'firefox', 'edge', 'other'] as const
export const OSES = ['macos', 'windows', 'linux', 'ios', 'android', 'other'] as const
export const DEVICES = ['desktop', 'tablet', 'phone'] as const
/** Why check 3 ("Server down: returns the error text") failed. */
export const REASONS = ['http', 'healthy', 'undefined', 'threw', 'other'] as const
/** The intro's ten steps, in order (the slides' names in keynote/App.tsx, then step 10). */
export const STEP_NAMES = ['Setup', 'The call', 'Dedupe', 'Share', 'Middleware', 'Pagination', 'Polling', 'Caching', 'Search, finished', 'Your turn'] as const

export type Browser = (typeof BROWSERS)[number]
export type Os = (typeof OSES)[number]
export type Device = (typeof DEVICES)[number]
export type Reason = (typeof REASONS)[number]

export interface Search { q: string; n: number; pos: number | null }
export interface Copy { block: string; ok: boolean }
export interface Run { tab: string; edited: boolean; typeErrors: number; threw: boolean }
export interface Attempt { pass: boolean[]; reason: Reason | null }
export interface Slide { reached: boolean; ended: boolean; ms: number; pauses: number; replays: number; seeks: number; back: number; jumps: number; copies: number; copyFails: number }
export interface Step10 {
  editor: '' | 'loaded' | 'reader' | 'error'; loadMs: number; runs: { healthy: number; down: number; slow: number }
  attempts: Attempt[]; solution: boolean; startOver: boolean; drawer: boolean; passMs: number; outcome: '' | 'docs' | 'again'
}
export interface Intro {
  start: { method: 'click' | 'enter'; ms: number; prefetched: boolean } | null
  slides: Slide[]; furthest: number; skipFrom: '' | 'start' | number; step10: Step10 | null
}
export interface PageRecord {
  v: 1; pv: string; seq: number; path: string
  tags: { ref?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string }
  from: string; tz: string; lang: string; browser: Browser; os: Os; device: Device
  exit: boolean; engagedMs: number
  searches: Search[]; copies: Copy[]; out: { github: number; npm: number; compare: number }
  tabs: string[]; runs: Run[]; editorFailed: boolean
  intro: Intro | null
}

export interface WireStep10 { ed: string; lm: number; rh: number; rd: number; rs: number; at: string; so: boolean; ov: boolean; dr: boolean; pm: number; oc: string }
export interface WireIntro { st: string; sl: string; fu: number; sk: string; t?: WireStep10 }
export interface Wire {
  v: number; pv: string; seq: number; p: string; tg?: Record<string, string>; f: string; tz: string; lg: string
  br: string; os: string; dv: string; x: boolean; e: number
  se: string; cp: string; o: { g: number; n: number; c: number }; tb: string; ru: string; ef: boolean
  it?: WireIntro
}

const list = (item: string, max: number) => `^$|^${item}(,${item}){0,${max - 1}}$`
const Q = '[a-z0-9 ._@/+#-]{1,60}'
const SLIDE = '[01]:[01]:[0-9]{1,7}(:[0-9]{1,3}){7}'
/** The patterns firestore.rules uses, character for character. */
export const RX = {
  pv: '^[a-z0-9]{12}$',
  path: '^/[a-z0-9/._~-]{0,120}$',
  from: '^$|^/[a-z0-9/._~-]{0,120}$|^https?://[a-z0-9.-]{1,100}(:[0-9]{1,5})?$',
  tag: '^[a-z0-9._-]{1,40}$',
  tz: '^$|^[A-Za-z0-9_/+-]{1,40}$',
  lang: '^$|^[a-z]{2,3}(-[a-z0-9]{2,8})?$',
  searches: list(`${Q}:[0-9]{1,4}:([0-9]{1,2}|-)`, CAPS.searches),
  copies: list('(install|/[a-z0-9/._~-]{0,120}#[0-9]{1,3}):[01]', CAPS.copies),
  tabs: list('[a-z-]{1,24}', CAPS.tabs),
  runs: list('[a-z-]{1,24}:[01]:[0-9]{1,2}:[01]', CAPS.runs),
  start: '^$|^(click|enter):[0-9]{1,7}:[01]$',
  slides: `^$|^${SLIDE}(,${SLIDE}){8}$`,
  attempts: list('[pf]{5}:(http|healthy|undefined|threw|other)?', CAPS.attempts),
} as const

export const emptySlide = (): Slide => ({ reached: false, ended: false, ms: 0, pauses: 0, replays: 0, seeks: 0, back: 0, jumps: 0, copies: 0, copyFails: 0 })
export const emptyStep10 = (): Step10 => ({ editor: '', loadMs: 0, runs: { healthy: 0, down: 0, slow: 0 }, attempts: [], solution: false, startOver: false, drawer: false, passMs: 0, outcome: '' })
export const emptyIntro = (): Intro => ({ start: null, slides: Array.from({ length: 9 }, emptySlide), furthest: 0, skipFrom: '', step10: null })

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : 0)))
const bit = (b: boolean) => (b ? '1' : '0')
export const cleanQuery = (q: string) => q.toLowerCase().replace(/[^a-z0-9 ._@/+#-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CAPS.query).trim()
export const cleanPath = (p: string) => ('/' + p.toLowerCase().replace(/^\/+/, '').replace(/[^a-z0-9/._~-]/g, '-')).slice(0, CAPS.path + 1)
export const cleanTag = (v: string) => v.toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, CAPS.tag)
const cleanTab = (t: string) => t.toLowerCase().replace(/[^a-z-]/g, '-').slice(0, 24) || 'other'
const cleanBlock = (b: string) => (b === 'install' ? b : (() => { const [path, n] = b.split('#'); return `${cleanPath(path ?? '/')}#${clamp(Number(n), 0, 999)}` })())

export function encodeRecord(r: PageRecord): Wire {
  const tg: Record<string, string> = {}
  for (const k of ['ref', 'utm_source', 'utm_medium', 'utm_campaign'] as const) {
    const v = r.tags[k] && cleanTag(r.tags[k]!)
    if (v) tg[k] = v
  }
  const w: Wire = {
    v: SCHEMA_VERSION, pv: r.pv, seq: clamp(r.seq, 1, CAPS.sends), p: cleanPath(r.path),
    f: new RegExp(RX.from).test(r.from) ? r.from : '', tz: new RegExp(RX.tz).test(r.tz) ? r.tz : '',
    lg: new RegExp(RX.lang).test(r.lang) ? r.lang : '', br: r.browser, os: r.os, dv: r.device,
    x: r.exit, e: clamp(r.engagedMs, 0, 86_400_000),
    se: r.searches.map((s) => ({ ...s, q: cleanQuery(s.q) })).filter((s) => s.q).slice(0, CAPS.searches)
      .map((s) => `${s.q}:${clamp(s.n, 0, 9999)}:${s.pos === null ? '-' : clamp(s.pos, 0, 99)}`).join(','),
    cp: r.copies.slice(0, CAPS.copies).map((c) => `${cleanBlock(c.block)}:${bit(c.ok)}`).join(','),
    o: { g: clamp(r.out.github, 0, 999), n: clamp(r.out.npm, 0, 999), c: clamp(r.out.compare, 0, 999) },
    tb: r.tabs.slice(0, CAPS.tabs).map(cleanTab).join(','),
    ru: r.runs.slice(0, CAPS.runs).map((x) => `${cleanTab(x.tab)}:${bit(x.edited)}:${clamp(x.typeErrors, 0, 99)}:${bit(x.threw)}`).join(','),
    ef: r.editorFailed,
  }
  if (Object.keys(tg).length) w.tg = tg
  if (r.intro) {
    const i = r.intro
    const n3 = (x: number) => clamp(x, 0, 999)
    w.it = {
      st: i.start ? `${i.start.method}:${clamp(i.start.ms, 0, 9_999_999)}:${bit(i.start.prefetched)}` : '',
      sl: i.slides.slice(0, 9).map((s) => [bit(s.reached), bit(s.ended), clamp(s.ms, 0, 9_999_999), n3(s.pauses), n3(s.replays), n3(s.seeks), n3(s.back), n3(s.jumps), n3(s.copies), n3(s.copyFails)].join(':')).join(','),
      fu: clamp(i.furthest, 0, 10), sk: i.skipFrom === '' ? '' : String(i.skipFrom),
    }
    if (i.step10) {
      const t = i.step10
      w.it.t = {
        ed: t.editor, lm: clamp(t.loadMs, 0, 600_000), rh: n3(t.runs.healthy), rd: n3(t.runs.down), rs: n3(t.runs.slow),
        at: t.attempts.slice(0, CAPS.attempts).map((a) => `${a.pass.slice(0, 5).map((p) => (p ? 'p' : 'f')).join('')}:${a.reason ?? ''}`).join(','),
        so: t.solution, ov: t.startOver, dr: t.drawer, pm: clamp(t.passMs, 0, 86_400_000), oc: t.outcome,
      }
    }
  }
  return w
}

const isInt = (x: unknown, lo: number, hi: number): x is number => Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi
const fits = (x: unknown, rx: string): x is string => typeof x === 'string' && new RegExp(rx).test(x)
const oneOf = <T extends string>(x: unknown, xs: readonly T[]): x is T => typeof x === 'string' && (xs as readonly string[]).includes(x)
const items = (s: string) => (s ? s.split(',') : [])

export function decodeWire(raw: unknown): PageRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const w = raw as Wire
  if (w.v !== SCHEMA_VERSION || !fits(w.pv, RX.pv) || !isInt(w.seq, 1, CAPS.sends) || !fits(w.p, RX.path)) return null
  if (!fits(w.f, RX.from) || !fits(w.tz, RX.tz) || !fits(w.lg, RX.lang)) return null
  if (!oneOf(w.br, BROWSERS) || !oneOf(w.os, OSES) || !oneOf(w.dv, DEVICES)) return null
  if (typeof w.x !== 'boolean' || !isInt(w.e, 0, 86_400_000) || typeof w.ef !== 'boolean') return null
  if (!fits(w.se, RX.searches) || !fits(w.cp, RX.copies) || !fits(w.tb, RX.tabs) || !fits(w.ru, RX.runs)) return null
  if (!w.o || !isInt(w.o.g, 0, 999) || !isInt(w.o.n, 0, 999) || !isInt(w.o.c, 0, 999)) return null
  const tags: PageRecord['tags'] = {}
  if (w.tg !== undefined) {
    for (const [k, v] of Object.entries(w.tg)) {
      if (!['ref', 'utm_source', 'utm_medium', 'utm_campaign'].includes(k) || !fits(v, RX.tag)) return null
      tags[k as keyof PageRecord['tags']] = v
    }
  }
  let intro: Intro | null = null
  if (w.it !== undefined) {
    const i = w.it
    if (!fits(i.st, RX.start) || !fits(i.sl, RX.slides) || !isInt(i.fu, 0, 10) || !['', 'start', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].includes(i.sk)) return null
    const [m, ms, pre] = i.st ? i.st.split(':') : []
    intro = {
      start: i.st ? { method: m as 'click' | 'enter', ms: Number(ms), prefetched: pre === '1' } : null,
      slides: i.sl ? items(i.sl).map((s) => { const [r, e, t, pa, re, se, bk, ju, co, cf] = s.split(':').map(Number); return { reached: r === 1, ended: e === 1, ms: t, pauses: pa, replays: re, seeks: se, back: bk, jumps: ju, copies: co, copyFails: cf } }) : Array.from({ length: 9 }, emptySlide),
      furthest: i.fu, skipFrom: i.sk === '' ? '' : i.sk === 'start' ? 'start' : Number(i.sk), step10: null,
    }
    if (i.t !== undefined) {
      const t = i.t
      if (!['', 'loaded', 'reader', 'error'].includes(t.ed) || !['', 'docs', 'again'].includes(t.oc) || !fits(t.at, RX.attempts)) return null
      if (![t.lm, t.rh, t.rd, t.rs, t.pm].every((n, k) => isInt(n, 0, [600_000, 999, 999, 999, 86_400_000][k]))) return null
      if (![t.so, t.ov, t.dr].every((b) => typeof b === 'boolean')) return null
      intro.step10 = {
        editor: t.ed as Step10['editor'], loadMs: t.lm, runs: { healthy: t.rh, down: t.rd, slow: t.rs },
        attempts: items(t.at).map((a) => { const [p, reason] = a.split(':'); return { pass: [...p].map((c) => c === 'p'), reason: (reason || null) as Reason | null } }),
        solution: t.so, startOver: t.ov, drawer: t.dr, passMs: t.pm, outcome: t.oc as Step10['outcome'],
      }
    }
  }
  return {
    v: 1, pv: w.pv, seq: w.seq, path: w.p, tags, from: w.f, tz: w.tz, lang: w.lg, browser: w.br, os: w.os, device: w.dv,
    exit: w.x, engagedMs: w.e,
    searches: items(w.se).map((s) => { const [q, n, pos] = s.split(':'); return { q, n: Number(n), pos: pos === '-' ? null : Number(pos) } }),
    copies: items(w.cp).map((c) => { const k = c.lastIndexOf(':'); return { block: c.slice(0, k), ok: c.slice(k + 1) === '1' } }),
    out: { github: w.o.g, npm: w.o.n, compare: w.o.c },
    tabs: items(w.tb),
    runs: items(w.ru).map((x) => { const [tab, e, t, h] = x.split(':'); return { tab, edited: e === '1', typeErrors: Number(t), threw: h === '1' } }),
    editorFailed: w.ef, intro,
  }
}

export type FsValue =
  | { stringValue: string } | { integerValue: string } | { booleanValue: boolean } | { mapValue: { fields: Record<string, FsValue> } }
/** Firestore REST v1 typed values. Every number this schema sends is an integer. */
export function toFields(o: object): Record<string, FsValue> {
  const out: Record<string, FsValue> = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue
    if (typeof v === 'string') out[k] = { stringValue: v }
    else if (typeof v === 'boolean') out[k] = { booleanValue: v }
    else if (typeof v === 'number') out[k] = { integerValue: String(Math.trunc(v)) }
    else if (v && typeof v === 'object') out[k] = { mapValue: { fields: toFields(v) } }
    else throw new TypeError(`analytics: can't encode ${k}`)
  }
  return out
}
