// The challenge's five checks, judged from what harness.ts reports about a run. Messages are the
// prototype's (docs/prototypes/intro-keynote-2026-10-08/src/playground/challenge.ts), word for word.
import { describeThrown, inspect } from './format'
import { DOWN, ENDPOINT, HEALTHY } from './files'
import type { ChallengeRun } from './harness'
import type { Diagnostic } from '../../playground/editor'

export type CheckId = 'liaise' | 'healthy' | 'down' | 'throws' | 'types'
export type CheckStatus = 'idle' | 'running' | 'pass' | 'fail'
export interface CheckState { status: CheckStatus; reason?: string }

export const CHECKS: Array<{ id: CheckId; label: string }> = [
  { id: 'liaise', label: 'Calls GET /notifications/unread through liaise' },
  { id: 'healthy', label: `Healthy server: returns '${HEALTHY}'` },
  { id: 'down', label: `Server down: returns '${DOWN}'` },
  { id: 'throws', label: 'Never throws' },
  { id: 'types', label: 'No type errors' },
]

const pass = (reason?: string): CheckState => ({ status: 'pass', reason })
const fail = (reason: string): CheckState => ({ status: 'fail', reason })

/** Why a run produced no value, in a sentence; undefined when it did. */
function noValue(r: ChallengeRun, server: string): string | undefined {
  if (r.loadError !== undefined) return `The file didn't load: ${describeThrown(r.loadError)}`
  if (r.ended === 'timeout') return `With the server ${server}, unreadLabel() didn't finish within ${TIMEOUT_S} seconds.`
  if (r.ended === 'stopped') return 'The check was stopped.'
  if (!r.exported) return 'There is no exported unreadLabel to call. Keep the export in front of the function.'
  if (r.threw !== undefined) return `With the server ${server}, unreadLabel() threw ${describeThrown(r.threw)}.`
  return undefined
}

export const TIMEOUT_S = 8

/** 1. A GET to the endpoint went out through a liaise client in the healthy run. */
export function checkLiaise(r: ChallengeRun): CheckState {
  const at = (path: string) => new URL(path, 'https://x').pathname
  const hits = r.sent.filter((s) => at(s.path) === ENDPOINT)
  const viaLiaise = r.viaLiaise.filter((s) => at(s.path) === ENDPOINT)
  const good = viaLiaise.find((s) => s.method === 'GET')
  if (good) return pass(`GET ${good.path} went out through liaise.`)
  if (viaLiaise.length) return fail(`liaise sent ${viaLiaise[0].method} ${viaLiaise[0].path}. The endpoint is a GET.`)
  if (hits.length) return fail(`${ENDPOINT} was called with fetch directly. Call it through a client from createApi instead.`)
  if (r.loadError !== undefined) return fail(`The file didn't load, so nothing was sent. ${describeThrown(r.loadError)}`)
  const other = r.viaLiaise[0]
  if (other) return fail(`liaise asked for ${other.method} ${other.path}, not ${ENDPOINT}. Check the path in defineRequest.`)
  if (r.sent.length) return fail(`A request went to ${r.sent[0].path}, not through liaise to ${ENDPOINT}.`)
  if (!r.exported) return fail('Nothing called unreadLabel(): keep the export in front of it.')
  return fail(`No request reached ${ENDPOINT}. Define it with defineRequest, add it to createApi, and call it in unreadLabel().`)
}

/** 2. The healthy run returned exactly HEALTHY. */
export function checkHealthy(r: ChallengeRun): CheckState {
  const why = noValue(r, 'healthy')
  if (why) return fail(why)
  const v = r.returned!.value
  if (v === HEALTHY) return pass()
  if (typeof v === 'number') return fail(`It returned the number ${v}. Return the text '${HEALTHY}'.`)
  return fail(`It returned ${inspect(v)}. Expected '${HEALTHY}'.`)
}

/** Source with comments removed (URLs in strings survive: '//' after ':' is kept). */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')

/** 3. The down run returned exactly DOWN, built from error.kind. */
export function checkDown(r: ChallengeRun, source: string): CheckState {
  if (r.loadError === undefined && r.ended === 'done' && r.exported && r.threw !== undefined) return fail('It threw instead of returning the text. See check 4.')
  const why = noValue(r, 'down')
  if (why) return fail(why)
  const v = r.returned!.value
  if (v === DOWN) {
    if (!/\bkind\b/.test(code(source))) return fail(`The text is right, but 'http' is typed by hand. Read it from error.kind, so a timeout or an offline user reads right too.`)
    return pass()
  }
  if (v === HEALTHY) return fail(`It returned '${HEALTHY}' while the server was down. Check error before you use data.`)
  if (typeof v === 'string' && v.includes('(undefined)')) return fail(`It returned ${inspect(v)}: the kind was undefined. Read it from the error of the same call.`)
  return fail(`It returned ${inspect(v)}. Expected '${DOWN}'.`)
}

/** 4. Neither run threw (loading the file, or calling unreadLabel()). */
export function checkThrows(a: ChallengeRun, b: ChallengeRun): CheckState {
  for (const [r, server] of [[a, 'healthy'], [b, 'down']] as const) {
    if (r.loadError !== undefined) return fail(`Loading the file threw ${describeThrown(r.loadError)}`)
    if (r.threw !== undefined) {
      const hint = /null|undefined/.test(describeThrown(r.threw)) ? ' Check error before you read data.' : ''
      return fail(`With the server ${server}, unreadLabel() threw ${describeThrown(r.threw)}.${hint}`)
    }
  }
  if (a.ended === 'timeout' || b.ended === 'timeout') return fail(`It didn't finish within ${TIMEOUT_S} seconds, so this can't be told.`)
  if (!a.exported) return fail('There is no exported unreadLabel to call.')
  return pass()
}

/** 5. The TypeScript worker reports no errors. */
export function checkTypes(diagnostics: Diagnostic[]): CheckState {
  if (!diagnostics.length) return pass()
  const n = diagnostics.length
  const first = diagnostics[0]
  return fail(`${n} type error${n === 1 ? '' : 's'}. Line ${first.line}: ${first.message}`)
}
