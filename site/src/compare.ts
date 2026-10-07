// Everything /compare/ states with a number or a ranking in it, computed from
// compare/results.json at build time. A cell comes from compare/cells.mjs, the function
// compare/report.mjs prints the README's table with, so the page and the README can't disagree.
import results from '../../compare/results.json'
import { NAMES, METHOD_FOR, OVERHEAD, cell } from '../../compare/cells.mjs'

export { NAMES, METHOD_FOR, OVERHEAD, cell }
export const data = results

export type Variant = 'configured' | 'default'
export type Kind = 'value' | 'throws' | 'code' | 'none'
type Outcome = { outcome: string; ms: number }
type Mode = 'sequential' | 'concurrent'
type Scenario = (typeof results.scenarios)[number]

const sizes = results.sizes as Record<string, { gzip: number; brotli: number }>
const overhead = results.overhead as Record<string, Record<Mode, { median: number; min: number; max: number }>>

export const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)
export const kb = (bytes: number) => (bytes / 1024).toFixed(1)
export const count = (n: number) => n.toLocaleString('en-US')
const pct = (d: number) => Math.round(Math.abs(d) * 100)
const scenario = (id: string) => results.scenarios.find((s) => s.id === id)!
export const outcome = (id: string, name: string, v: Variant) =>
  (scenario(id).results as Record<string, Record<Variant, Outcome>>)[name][v].outcome
const THREW_OR_ENDED = /(?:^|: )(throws|error result)\b/
/** Every library but liaise; fetch counts, as the floor. */
const others = NAMES.filter((n) => n !== 'liaise')
/** The libraries a reader would choose between: fetch is the runtime's own. */
const libraries = NAMES.filter((n) => n !== 'fetch' && n !== 'liaise')

// ── When and against what ────────────────────────────────────────────────────────────────
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const measured = {
  date: results.meta.date,
  readableDate: (() => { const [y, m, d] = results.meta.date.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}` })(),
  node: results.meta.node.replace(/^v/, ''),
  platform: results.meta.platform,
  versions: results.meta.versions as Record<string, string>,
}

// ── The two setups ───────────────────────────────────────────────────────────────────────
export const VARIANTS: Record<Variant, { label: string; short: string; blurb: string }> = {
  configured: {
    label: "With each library's documented setup",
    short: 'Documented setup',
    blurb: "Only options and patterns from each library's own docs. Code beyond the docs, where a scenario can't be done otherwise, is marked.",
  },
  default: {
    label: 'Out of the box',
    short: 'Out of the box',
    blurb: 'Each library called the most obvious way, with no options set.',
  },
}

export const KINDS: Record<Kind, { label: string; help: string }> = {
  value: { label: 'no throw', help: "The call didn't throw. The text says what happened." },
  throws: { label: 'throws', help: 'The call threw.' },
  code: { label: 'your code', help: "Needed hand-written code beyond the library's docs." },
  none: { label: 'no option', help: 'The library has no built-in option for this.' },
}

/** The setup note for one library's call, split into text, `code` and doc links. */
export type NotePart = { text: string } | { code: string } | { href: string; label: string }
export function noteParts(note: string): NotePart[] {
  const parts: NotePart[] = []
  for (const piece of note.split(/(https?:\/\/[^\s),]+)/)) {
    if (!piece) continue
    if (/^https?:\/\//.test(piece)) { parts.push({ href: piece, label: linkLabel(piece) }); continue }
    piece.split(/`([^`]+)`/).forEach((t, i) => t && parts.push(i % 2 ? { code: t } : { text: t }))
  }
  return parts
}
function linkLabel(href: string) {
  const u = new URL(href)
  const hash = decodeURIComponent(u.hash).replace(/[^\x20-\x7e]/g, '')
  const gh = u.pathname.match(/^\/[^/]+\/([^/]+)\/blob\/[^/]+\/(?:.*\/)?([^/]+)$/)
  if (u.hostname === 'github.com' && gh) return `${gh[1]} ${gh[2]}${hash}`
  if (u.hostname === 'developer.mozilla.org') return `MDN ${u.pathname.replace(/^\/[^/]+\/docs\/Web\/API\//, '')}`
  return `${u.hostname}${u.pathname}`
}
export function noteFor(name: string, variant: Variant, method: string): string | undefined {
  const r = (results.scenarios[0].results as Record<string, { notes?: Record<string, string>; defaultNotes?: Record<string, string> }>)[name]
  return (variant === 'configured' ? r.notes : r.defaultNotes)?.[method]
}

/** The guide page that shows liaise's side of each scenario. */
export const GUIDE: Record<string, string> = {
  hang: '/guide/cancelling-deadlines-and-stale-requests/',
  deadline: '/guide/cancelling-deadlines-and-stale-requests/',
  'refresh-stampede': '/recipes/add-an-auth-header-and-refresh-the-token-on-a-401/',
  'search-race': '/recipes/search-as-you-type/',
  'missing-param': '/guide/defining-endpoints/',
  'wrong-shape': '/guide/validating-responses/',
}
export const guideFor = (id: string) => GUIDE[id] ?? '/guide/handling-errors/'

// ── Hand-written code ────────────────────────────────────────────────────────────────────
const codeRows = (name: string, v: Variant) => results.scenarios.filter((s) => cell(s, name, v).kind === 'code')
export const codeCounts = (v: Variant) =>
  list(NAMES.map((n) => ({ n, k: codeRows(n, v).length })).sort((a, b) => b.k - a.k).map(({ n, k }) => `${n} ${k}`))

export const liaiseCode = (() => {
  const rows = codeRows('liaise', 'configured').map((s) => `“${s.title}”`)
  const throws = results.scenarios.some((s) => (['configured', 'default'] as const).some((v) => /(?:^|: )throws\b/.test(outcome(s.id, 'liaise', v))))
  return `${rows.length ? `liaise needed it only in ${list(rows)}.` : 'liaise needed none.'}${throws ? '' : ' No liaise cell throws.'}`
})()

export const pathParam = (() => {
  const refusers = NAMES.filter((n) => /^refused before sending/.test(outcome('missing-param', n, 'configured')))
  if (!refusers.length) return ''
  return refusers.length === 1
    ? `${refusers[0]} is the only one that refuses an undefined path param before sending the request.`
    : `${list(refusers)} refuse an undefined path param before sending the request.`
})()

// ── Size ─────────────────────────────────────────────────────────────────────────────────
export const sizeRows = [...NAMES, 'liaise + retryMiddleware'].map((name) => ({ name, gzip: kb(sizes[name].gzip), brotli: kb(sizes[name].brotli) }))
const place = (m: 'gzip' | 'brotli') => {
  const by = (a: string, b: string) => sizes[a][m] - sizes[b][m]
  return {
    smaller: libraries.filter((n) => sizes[n][m] < sizes.liaise[m]).sort(by),
    larger: libraries.filter((n) => sizes[n][m] > sizes.liaise[m]).sort(by),
  }
}
const placeText = (p: ReturnType<typeof place>) =>
  [p.smaller.length ? `larger than ${list(p.smaller)}` : '', p.larger.length ? `smaller than ${list(p.larger)}` : ''].filter(Boolean).join(' and ')
export const sizePlace = (() => {
  const g = place('gzip'), b = place('brotli')
  return JSON.stringify(g) === JSON.stringify(b)
    ? `Gzipped or brotli-compressed, liaise is ${placeText(g)}.`
    : `Gzipped, liaise is ${placeText(g)}. Brotli-compressed, it is ${placeText(b)}.`
})()

// ── Requests per second ──────────────────────────────────────────────────────────────────
export const MODES: { id: Mode; label: string; lead: string }[] = [
  { id: 'sequential', label: 'One at a time', lead: 'One request at a time' },
  { id: 'concurrent', label: `${OVERHEAD.inFlight} in flight`, lead: `With ${OVERHEAD.inFlight} requests in flight` },
]
const rps = (n: string, mode: Mode) => overhead[n][mode]
export const rpsCell = (n: string, mode: Mode) => { const x = rps(n, mode); return { median: count(x.median), range: `(${count(x.min)}–${count(x.max)})` } }
const relative = (mode: Mode) => {
  const base = rps('liaise', mode).median
  return others.map((n) => ({ n, d: (rps(n, mode).median - base) / base }))
}
const isNoise = (d: number) => Math.abs(d) < OVERHEAD.noise
export const overheadMethod = `Median (min–max) of ${OVERHEAD.rounds} interleaved rounds of ${count(OVERHEAD.calls)} calls each, after ${count(OVERHEAD.warmup)} warm-up calls per library. Measured on ${results.meta.overheadNote}. Differences under about ${OVERHEAD.noise * 100}% are noise.`
export function overheadSentence(mode: Mode) {
  const { lead } = MODES.find((m) => m.id === mode)!
  const rel = relative(mode)
  const ties = rel.filter((r) => isNoise(r.d)).map((r) => r.n)
  const apart = rel.filter((r) => !isNoise(r.d)).sort((a, b) => b.d - a.d)
  const parts = []
  if (ties.length) parts.push(`liaise ties ${list(ties)}`)
  if (apart.length) parts.push(apart.map((r, i) => `${r.n} ${i ? '' : 'handles '}about ${pct(r.d)}% ${r.d > 0 ? 'more' : 'fewer'}${i ? '' : ' requests per second than liaise'}`).join(', '))
  return `${lead}, ${parts.join('; ')}.`
}

// ── Where liaise loses ───────────────────────────────────────────────────────────────────
export const losses = {
  /** Out of the box, a hung server leaves liaise waiting. */
  timeout: (() => {
    const waiting = outcome('hang', 'liaise', 'default')
    if (!/^still waiting/.test(waiting)) return null
    const timesOut = others.filter((n) => THREW_OR_ENDED.test(outcome('hang', n, 'default')))
    const who = timesOut.length === 0 ? 'None of the others times out by default either.'
      : timesOut.length === 1 ? `Only ${timesOut[0]} times out by default.` : `${list(timesOut)} time out by default.`
    return { waiting, who, configured: outcome('hang', 'liaise', 'configured') }
  })(),
  /** Out of the box, a 204 on a JSON call is an error. */
  empty204: (() => {
    const own = outcome('empty-204', 'liaise', 'default')
    if (!/^(throws|error result)/.test(own)) return null
    const throwers = others.filter((n) => /^throws/.test(outcome('empty-204', n, 'default')))
    const resolvers = others.filter((n) => /^resolves/.test(outcome('empty-204', n, 'default')))
    const verb = (xs: string[], v: string) => (xs.length ? `${list(xs)} ${v}${xs.length === 1 ? 's' : ''}` : '')
    return { own, parse: /parse/.test(own), others: [verb(throwers, 'throw'), verb(resolvers, 'resolve')].filter(Boolean).join('; ') }
  })(),
  /** The harness's own note: no option for an endpoint that answers JSON or an empty body. */
  jsonOrEmpty: (() => {
    const clause = noteFor('liaise', 'configured', 'getJson')?.split('; ').find((c) => /^liaise has no option for/.test(c))
    if (!clause) return null
    const [text, href] = [clause.replace(/\s*\(https?:[^)]*\)\s*$/, ''), clause.match(/https?:\/\/[^\s),]+/)?.[0]]
    const ky = noteFor('ky', 'configured', 'getJson')?.split('; ').find((c) => /empty body/.test(c))
    return { text, href, ky: ky?.replace(/\s*\(https?:[^)]*\)\s*$/, ''), kyHref: ky?.match(/https?:\/\/[^\s),]+/)?.[0] }
  })(),
  /** Out of the box, others retry the deadline row's 503s and liaise doesn't. */
  retries: (() => {
    const attempts = (n: string) => Number(outcome('deadline', n, 'default').match(/(\d+) attempts?/)?.[1] ?? 0)
    const retriers = others.filter((n) => attempts(n) > attempts('liaise')).sort((a, b) => attempts(b) - attempts(a))
    if (!retriers.length) return null
    return { text: `With no options set, ${list(retriers.map((n, i) => `${n}${i ? '' : ' made'} ${attempts(n)}`))} attempts at the slow 503s; liaise made ${attempts('liaise')}.`, retriers }
  })(),
  /** Libraries smaller than liaise. */
  size: (() => {
    const smaller = place('gzip').smaller
    if (!smaller.length) return null
    return { smaller, text: `Gzipped, liaise is ${kb(sizes.liaise.gzip)} kB; ${list(smaller.map((n) => `${n} ${kb(sizes[n].gzip)} kB`))}.` }
  })(),
  /** Libraries that handle more requests per second than liaise, beyond the noise. */
  overhead: MODES.map(({ id, lead }) => {
    const ahead = relative(id).filter((r) => r.d >= OVERHEAD.noise)
    if (!ahead.length) return null
    return { id, ahead: ahead.map((r) => r.n), text: `${lead}, ${list(ahead.map((r) => `${r.n} handles about ${pct(r.d)}% more requests per second than liaise`))}.` }
  }).filter((x) => x !== null),
}

// ── ky, row by row ───────────────────────────────────────────────────────────────────────
// Two cells match when they differ only in throwing versus returning an error result, and
// both needed hand-written code or neither did.
const norm = (o: string) => o.replace(/throws [^,]+|error result \([^)]*\)/g, 'ERR')
const needsCode = (s: Scenario, n: string) => cell(s, n, 'configured').kind === 'code'
const differingRows = (n: string) => results.scenarios.filter((s) =>
  norm(outcome(s.id, n, 'configured')) !== norm(outcome(s.id, 'liaise', 'configured')) || needsCode(s, n) !== needsCode(s, 'liaise'))
export const ky = (() => {
  const rows = differingRows('ky')
  const fewest = others.every((n) => n === 'ky' || differingRows(n).length > rows.length)
  const timesOut = others.filter((n) => THREW_OR_ENDED.test(outcome('hang', n, 'default')))
  const retries = losses.retries?.retriers ?? []
  return {
    rows,
    rowsText: `Apart from throwing where liaise returns an error result, ky's documented setup differs from liaise's in ${rows.length} of the ${results.scenarios.length} rows${fewest ? ', fewer than any other library here' : ''}:`,
    defaults: `Out of the box, ${timesOut.length === 1 && timesOut[0] === 'ky' ? 'only ky times out' : `${list(timesOut)} time out`}${retries.length ? `, and ${list(retries)} retr${retries.length === 1 ? 'ies' : 'y'}` : ''}.`,
    size: `ky is ${kb(sizes.ky.gzip)} kB gzipped, liaise ${kb(sizes.liaise.gzip)} kB.`,
  }
})()
