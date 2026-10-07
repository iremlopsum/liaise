// Runs one example at a time, and every run can be stopped: it may never settle (a 'slow' id, a
// real server that stalls), so stopping cannot wait for it.
//
// A run swaps `fetch`, `console.log` and `console.error` on `scope` (window, in the page) and
// restores them the moment it ends: when the example settles, or at once on stop(). Ending a run
// aborts every request it started, through the run's own AbortController, combined by hand with
// each request's own signal (AbortSignal.any is above the project's runtime floor).
//
// An example keeps running after stop: its loops and timers go on. So what it does afterwards is
// tied to its run by id, not to the globals:
//   - instrument() binds the example module's `console` to its run, so later output is dropped
//     even while another run owns the global console;
//   - its liaise clients carry the run's gate middleware, last in each client's array, so a call
//     made after the run ended, or a client-level retry still waiting at stop, returns an abort
//     Result without sending anything. Middleware set on an endpoint or a call runs inside the
//     gate, so a retry it has pending at stop is not covered: it goes to whichever `fetch` is
//     current then. While the run is live the gate leaves the call alone: middleware sees what
//     it would see anywhere.
export interface RunScope {
  fetch: typeof fetch
  console: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
}

export interface RunnerOptions {
  /** Where the globals are swapped: window in the page, a stand-in object in tests. */
  scope: RunScope
  /** Sends a request the example makes, with the run's signal already combined in. */
  send: typeof fetch
  /** Requests the run doesn't own (the page's own files): sent with the original fetch, untouched. */
  passThrough?: (input: RequestInfo | URL) => boolean
  /** Prints a line of the example's console output. Lines from a run that has ended never get here. */
  print: (args: unknown[], tone: 'log' | 'error') => void
}

/** A liaise middleware, typed structurally so this module needs no import from liaise. */
export type Gate = (ctx: { request: { signal?: AbortSignal } }, next: () => Promise<unknown>) => Promise<unknown>

/** What an example module sees of its run (through instrument()'s bridge). */
export interface RunHandle {
  readonly id: number
  /** Aborts when the run ends, however it ends. */
  readonly signal: AbortSignal
  /** This run's console: silent once the run has ended. */
  readonly console: RunScope['console']
  /** Middleware for every liaise client the example creates (see instrument()): inert while the run is live. */
  readonly gate: Gate
}

export type RunEnd = { ended: 'done' } | { ended: 'stopped' } | { ended: 'threw'; error: unknown }

export interface Runner {
  /** Starts a run (stopping any current one), calls `execute`, and resolves when the run ends. */
  run(execute: (run: RunHandle) => Promise<unknown>): Promise<RunEnd>
  /** Ends the current run now, if there is one. */
  stop(): void
  readonly running: boolean
}

/** Both signals in one: aborts when either does, with that one's reason. */
export function combineSignals(own: AbortSignal | null | undefined, run: AbortSignal): AbortSignal {
  if (!own || own === run) return run
  if (own.aborted) return own
  if (run.aborted) return run
  const both = new AbortController()
  const fromOwn = () => { both.abort(own.reason); detach() }
  const fromRun = () => { both.abort(run.reason); detach() }
  const detach = () => { own.removeEventListener('abort', fromOwn); run.removeEventListener('abort', fromRun) }
  own.addEventListener('abort', fromOwn, { once: true })
  run.addEventListener('abort', fromRun, { once: true })
  return both.signal
}

const stopped = () => new DOMException('The run was stopped.', 'AbortError')
// Only once the run has ended: then the call goes to fetch already cancelled, and nothing is sent.
// While the run is live, ctx is untouched (an in-flight request is aborted by the run's fetch).
const gateFor = (signal: AbortSignal): Gate => (ctx, next) => {
  if (signal.aborted) ctx.request.signal = signal
  return next()
}
const ended = new AbortController()
ended.abort(stopped())
/** What an example whose run has already ended gets: no output, and no request ever goes out. */
const DEAD: RunHandle = { id: 0, signal: ended.signal, console: { log() {}, error() {} }, gate: gateFor(ended.signal) }

/** The global the instrumented module reads its run from: globalThis[BRIDGE](id). */
export const BRIDGE = Symbol.for('liaise.playground.run')

export function createRunner({ scope, send, print, passThrough }: RunnerOptions): Runner {
  let current: { handle: RunHandle; finish: (end: RunEnd) => void } | undefined
  let seq = 0
  Reflect.set(globalThis, BRIDGE, (id: number): RunHandle => (current?.handle.id === id ? current.handle : DEAD))

  function run(execute: (run: RunHandle) => Promise<unknown>): Promise<RunEnd> {
    stop()
    const id = ++seq
    const controller = new AbortController()
    const live = () => current?.handle.id === id
    const saved = { fetch: scope.fetch, log: scope.console.log, error: scope.console.error }
    const handle: RunHandle = {
      id,
      signal: controller.signal,
      console: {
        log: (...a) => { if (live()) print(a, 'log') },
        error: (...a) => { if (live()) print(a, 'error') },
      },
      gate: gateFor(controller.signal),
    }

    return new Promise<RunEnd>((resolve) => {
      const finish = (end: RunEnd) => {
        if (!live()) return
        current = undefined
        scope.fetch = saved.fetch
        scope.console.log = saved.log
        scope.console.error = saved.error
        controller.abort(stopped()) // a run's requests never outlive it
        resolve(end)
      }
      current = { handle, finish }
      scope.fetch = (input, init) => {
        if (passThrough?.(input)) return saved.fetch.call(scope, input, init)
        const own = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined)
        return send(input, { ...init, signal: combineSignals(own, controller.signal) })
      }
      scope.console.log = handle.console.log
      scope.console.error = handle.console.error
      new Promise((settle) => settle(execute(handle))) // a synchronous throw counts as 'threw' too
        .then(() => finish({ ended: 'done' }), (error: unknown) => finish({ ended: 'threw', error }))
    })
  }

  function stop() {
    current?.finish({ ended: 'stopped' })
  }

  return { run, stop, get running() { return current !== undefined } }
}

/**
 * Prepares an example's compiled JavaScript to run as run `id`. The module's `console` becomes
 * the run's (prepended on line 1, so line numbers stay true), and `from 'liaise'` points at
 * `shimUrl`, a module made by liaiseShim() that adds the run's gate to every client.
 * `liaise/middleware` and `liaise/testing` go straight to the build at `lib` (a URL ending in '/').
 */
export function instrument(js: string, id: number, shimUrl: string, lib: string): string {
  const files: Record<string, string> = { '/middleware': 'built-in-middleware.js', '/testing': 'testing.js' }
  const body = js.replace(/from\s+(['"])liaise(\/[a-z]+)?\1/g, (_, _q, sub?: string) =>
    `from '${sub ? `${lib}${files[sub] ?? 'index.js'}` : shimUrl}'`)
  return `const console = globalThis[Symbol.for('liaise.playground.run')](${id}).console;${body}`
}

/** The source of the module that stands in for 'liaise' in run `id`: liaise, with gated clients. */
export function liaiseShim(id: number, lib: string): string {
  const entry = JSON.stringify(`${lib}index.js`)
  return [
    `import * as liaise from ${entry}`,
    `export * from ${entry}`,
    `const gate = globalThis[Symbol.for('liaise.playground.run')](${id}).gate`,
    // Last of the client's middleware, so it also sees each retry a client-level retryMiddleware makes.
    `const gated = (create) => (config) => create({ ...config, middleware: [...(config?.middleware ?? []), gate] })`,
    `export const createApi = gated(liaise.createApi)`,
    `export const createGraphQL = gated(liaise.createGraphQL)`,
  ].join('\n')
}
