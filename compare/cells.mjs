// One comparison cell, shared by report.mjs (results.md and the README block) and the docs
// site's /compare/ page, so the two can't drift apart. No imports: the site loads this file
// directly, without compare/node_modules.

/** The libraries, in table order. */
export const NAMES = ['fetch', 'axios', 'ky', 'ofetch', 'liaise']

/** The contender method each scenario calls. Its note in results.json is that cell's setup. */
export const METHOD_FOR = {
  'http-500': 'getJson', offline: 'getJson', hang: 'getJson', 'broken-json': 'getJson', 'empty-204': 'getJson',
  'missing-param': 'getUser', 'search-race': 'search', 'refresh-stampede': 'getWithAuth', deadline: 'getWithDeadline', 'wrong-shape': 'getValidated',
}

/** Scenarios where timing is the point, so their cells show milliseconds. */
export const TIMING_ROWS = new Set(['hang', 'deadline'])

/**
 * How overhead.mjs measures (its RUNS, CALLS, POOL and WARMUP), and the difference below which
 * the report calls two results noise. results.json doesn't record these, so the site's tests
 * check them against overhead.mjs.
 */
export const OVERHEAD = { rounds: 10, calls: 2000, inFlight: 50, warmup: 2000, noise: 0.05 }

/** A note marks code beyond the library's docs with `hand-written`. */
export const handWritten = n => typeof n === 'string' && /\bhand-written\b/.test(n)

// "throws X", also after a scenario's prefix ("after 3.0s: throws X", "refused before sending: throws X").
const THROWS = /(?:^|: )throws\b/

/**
 * One cell of the outcome table: what the calling code got back (`text`), how it got it
 * (`kind`), and how the library was set up for that call (`note`, undefined when the harness
 * set no option for it).
 *
 * kind: 'code' when the setup needed hand-written code (the report's `*`), 'throws' when the
 * call threw, 'none' when the library has no built-in option (`—`), otherwise 'value'.
 *
 * @param {{ id: string, results: Record<string, any> }} s a scenario from results.json
 * @param {string} name one of NAMES
 * @param {'configured' | 'default'} variant
 * @returns {{ text: string, kind: 'value' | 'throws' | 'code' | 'none', note: string | undefined }}
 */
export function cell(s, name, variant) {
  const r = s.results[name]
  const res = r[variant]
  const note = (variant === 'configured' ? r.notes : r.defaultNotes)?.[METHOD_FOR[s.id]]
  let text = res.outcome
  if (TIMING_ROWS.has(s.id) && res.outcome !== '—' && !/ after \d/.test(` ${res.outcome}`)) text += `, ${res.ms} ms`
  const kind = handWritten(note) ? 'code' : THROWS.test(res.outcome) ? 'throws' : res.outcome === '—' ? 'none' : 'value'
  return { text, kind, note }
}
