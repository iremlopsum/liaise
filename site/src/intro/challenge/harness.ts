// Runs the reader's challenge file for real, the way /playground/ runs an example (runner.ts swaps
// fetch and the console for the run, and ends it however it ends), then calls its unreadLabel()
// and reports what happened: what it returned or threw, what reached the fake API, and what went
// through a liaise client. checks.ts judges the report.
import { createRunner, type RunHandle, type RunScope } from '../../playground/runner'
import { createFakeServer, FAKE_ORIGIN, type SentRequest, type SettledRequest, type UnreadMode } from '../../playground/fake-server'

export interface Sent { method: string; path: string }

export interface ChallengeRun {
  /** It finished, ran past its time, or was stopped (Stop, or a newer run). */
  ended: 'done' | 'timeout' | 'stopped'
  /** Importing the file threw: a syntax error, or a throw at the top level. */
  loadError?: unknown
  /** The file exports a function named unreadLabel. */
  exported: boolean
  /** What unreadLabel() resolved to. */
  returned?: { value: unknown }
  /** What unreadLabel() threw, or rejected with. */
  threw?: unknown
  /** Every request the fake API received during the run. */
  sent: Sent[]
  /** Every request to the fake API that a liaise client sent during the run. */
  viaLiaise: Sent[]
}

/** Imports the reader's file for one run (instrument() and liaiseShim(), so its clients are gated). */
export type Load = (run: RunHandle) => Promise<Record<string, unknown>>

export interface ChallengeRunnerOptions {
  /** Where fetch and the console are swapped: window in the page, globalThis in tests. */
  scope: RunScope
  print: (args: unknown[], tone: 'log' | 'error') => void
  /** Requests that load as usual: the page's own files. */
  passThrough?: (input: RequestInfo | URL) => boolean
  /** The fake API's traffic, for the Network panel. */
  onRequest?: (request: SentRequest) => void
  onSettle?: (settled: SettledRequest) => void
}

const originOf = (input: RequestInfo | URL): string | undefined => {
  try { return new URL(typeof input === 'string' ? input : 'href' in input ? input.href : input.url).origin } catch { return undefined }
}

export function createChallengeRunner({ scope, print, passThrough, onRequest, onSettle }: ChallengeRunnerOptions) {
  let mode: UnreadMode = 'healthy'
  let record: ChallengeRun | undefined
  const server = createFakeServer({
    unread: () => mode,
    onRequest: (r) => { record?.sent.push({ method: r.method, path: r.path }); onRequest?.(r) },
    onSettle,
  })
  const runner = createRunner({
    scope, print, passThrough,
    // Only the fake API answers here: any other host fails like a network that is down.
    send: (input, init) => (originOf(input) === FAKE_ORIGIN
      ? server.fetch(input, init)
      : Promise.reject(new TypeError(`Failed to fetch: only ${FAKE_ORIGIN} answers in the challenge`))),
    onLiaiseRequest: ({ method, url }) => {
      if (originOf(url) !== FAKE_ORIGIN) return
      const u = new URL(url)
      record?.viaLiaise.push({ method, path: u.pathname + u.search })
    },
  })

  async function run(load: Load, options: { mode: UnreadMode; timeoutMs: number }): Promise<ChallengeRun> {
    runner.stop()
    const r: ChallengeRun = { ended: 'done', exported: false, sent: [], viaLiaise: [] }
    mode = options.mode
    record = r
    server.reset()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; runner.stop() }, options.timeoutMs)
    const end = await runner.run(async (handle) => {
      let mod: Record<string, unknown>
      try { mod = await load(handle) } catch (e) { r.loadError = e; return }
      const fn = mod.unreadLabel
      r.exported = typeof fn === 'function'
      if (!r.exported) return
      try { r.returned = { value: await (fn as () => unknown)() } } catch (e) { r.threw = e }
    })
    clearTimeout(timer)
    if (record === r) record = undefined
    r.ended = timedOut ? 'timeout' : end.ended === 'stopped' ? 'stopped' : 'done'
    return r
  }

  return { run, stop: () => runner.stop(), get running() { return runner.running } }
}
