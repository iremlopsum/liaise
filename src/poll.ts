// =============================================================================
// poll.ts — ask an endpoint again on an interval, one shared poll per question
// =============================================================================
//
// Standalone, like paginate: it costs nothing unless imported. Where there is a
// `window` (browsers, React Native), callers that ask the same thing — the same
// endpoint function, params and per-request options — share one poll: one request
// per tick, every Result to all of them. On a server each caller polls on its own
// (see join). Spec: docs/superpowers/specs/2026-10-07-polling-design.md (local).
// =============================================================================
import type { CallOptions, Middleware, Result, SuccessResult } from './types.js'
import { ApiError, createNetworkErrorResult } from './result.js'
import { stableKey } from './utils/stable-key.js'
import { parseRetryAfter } from './utils/retry-after.js'

/** Any liaise endpoint: a `createApi` method or a `createGraphQL` operation. */
export type Pollable<P extends object, R> = (params: P, options?: CallOptions) => Promise<Result<R>>

/** Options for `poll`, plus any `CallOptions`, which apply to every request. */
export interface PollOptions extends Omit<CallOptions, 'signal'> {
  /**
   * Milliseconds to wait after each response before asking again. A value below
   * 1, or one that isn't finite, asks once and never repeats: that caller leaves
   * after its answer.
   */
  every: number
  /**
   * Keep polling while the browser tab is hidden. Default `false`: pause, and ask at
   * once when it's visible again, or once a `Retry-After` the server sent has passed.
   */
  inBackground?: boolean
  /** The longest wait after failures in a row. Default `max(every, 60_000)`. */
  maxEvery?: number
  /** Stops this caller. The shared poll stops when its last caller does. */
  signal?: AbortSignal
}

/** Options for `pollUntil`. */
export interface PollUntilOptions<R> extends PollOptions {
  /** Called with each successful result. Returning `true` resolves `pollUntil` with it. */
  until: (result: SuccessResult<R>) => boolean
  /** Milliseconds from the call before giving up with a `kind: 'timeout'` error. Default: no limit. */
  giveUpAfter?: number
}

/** Option keys that shape the poll rather than each request: not sent, not part of the sharing key. */
const POLL_ONLY = new Set(['every', 'inBackground', 'maxEvery', 'signal', 'until', 'giveUpAfter'])

interface Caller {
  /** NaN when this caller asked to poll once. */
  every: number
  maxEvery: number
  inBackground: boolean
  deliver: (result: Result<unknown>) => void
}

/**
 * A thrown callback or `until`, or an endpoint that fails to return a Result, never
 * breaks the poll. In a browser (where there is a `document`) it goes to `reportError`,
 * like an error thrown from an event handler. Everywhere else it's logged, saying what
 * failed: Deno's `reportError` ends the process, and Node has none. Never re-thrown
 * later: in Node an async throw would crash the process.
 */
function report(error: unknown, what: string): void {
  const g = globalThis as { reportError?: (error: unknown) => void }
  if (typeof document !== 'undefined' && typeof g.reportError === 'function') g.reportError(error)
  else console.error(`[liaise] poll: ${what} failed:`, error)
}

function deliver(caller: Caller, result: Result<unknown>): void {
  try {
    caller.deliver(result)
  } catch (error) {
    report(error, 'the callback')
  }
}

/** The document, looked up when needed (tests stub it), or undefined where there is none. */
function page(): Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | undefined {
  return typeof document === 'undefined' ? undefined : document
}

/** The longest setTimeout delay; anything above fires at once. */
const MAX_TIMER = 2_147_483_647

const positive = (ms: number | undefined): number => (typeof ms === 'number' && Number.isFinite(ms) && ms >= 1 ? ms : Number.NaN)

class SharedPoll {
  readonly callers = new Set<Caller>()
  last: Result<unknown> | undefined
  /** The method and URL of the latest attempt, recorded as it is sent. */
  request: { method: string; url: string } | undefined
  private failures = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private controller: AbortController | undefined
  private stopped = false
  /** When the last answer came, and the wait after it that is in effect. */
  private answeredAt = 0
  private wait = 0
  /** When the last answer's Retry-After ends; 0 when it had none. */
  private retryAt = 0
  private readonly onVisibility = (): void => this.visibilityChanged()

  constructor(
    private readonly endpoint: Pollable<object, unknown>,
    private readonly params: object,
    private readonly callOptions: CallOptions,
    private readonly forget: (poll: SharedPoll) => void,
  ) {}

  join(caller: Caller): () => void {
    if (this.callers.size === 0) {
      // A partial document shim may have no addEventListener: then there's nothing to watch.
      const doc = page()
      if (typeof doc?.addEventListener === 'function') doc.addEventListener('visibilitychange', this.onVisibility)
      this.callers.add(caller)
      if (!this.paused()) void this.ask()
    } else {
      this.callers.add(caller)
      const last = this.last
      if (last) {
        queueMicrotask(() => {
          // Nothing for a caller that left meanwhile (Strict Mode's cleanup), and not the
          // last answer if a newer one reached it first.
          if (!this.callers.has(caller)) return
          if (this.last === last) deliver(caller, last)
          // A shorter every takes effect now, not after the longer wait already started,
          // but only for a caller still there after that answer (a pollUntil it satisfied
          // has left). A backoff after failures stays as it is.
          if (this.timer !== undefined && this.callers.has(caller) && !this.failures && caller.every < this.wait) {
            this.arm(this.answeredAt + (this.wait = caller.every) - Date.now())
          }
        })
      }
      // A joiner can make an idle poll ask again: an inBackground caller in a hidden
      // tab, or a repeating caller joining a poll that asked once.
      if (this.timer === undefined && !this.controller && !this.paused() && (this.repeats() || !last)) this.resume()
    }
    return () => this.leave(caller)
  }

  private leave(caller: Caller): void {
    if (!this.callers.delete(caller)) return
    if (this.callers.size === 0) this.stop()
    else if (this.paused()) this.clearTimer()
  }

  private stop(): void {
    this.stopped = true
    this.clearTimer()
    this.controller?.abort()
    this.controller = undefined
    const doc = page()
    if (typeof doc?.removeEventListener === 'function') doc.removeEventListener('visibilitychange', this.onVisibility)
    this.forget(this)
  }

  private paused(): boolean {
    return page()?.visibilityState === 'hidden' && ![...this.callers].some(c => c.inBackground)
  }

  private repeats(): boolean {
    return [...this.callers].some(c => !Number.isNaN(c.every))
  }

  private visibilityChanged(): void {
    if (this.stopped) return
    if (this.paused()) this.clearTimer()
    else if (!this.controller && this.timer === undefined && (this.repeats() || !this.last)) this.resume()
  }

  /** Asks at once, unless the last answer's Retry-After hasn't passed yet: then when it has. */
  private resume(): void {
    const left = this.retryAt - Date.now()
    if (left > 0) this.arm(left)
    else void this.ask()
  }

  /** Asks again after `delay` ms: at once for 0 or less, and never later than the longest timer. */
  private arm(delay: number): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.ask()
    }, Math.min(Math.max(0, delay), MAX_TIMER))
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /**
   * Innermost and passive: records what is sent, so pollUntil's own results can
   * name the attempt. Runs after every user middleware and leaves ctx alone.
   */
  private readonly record: Middleware = (ctx, next) => {
    this.request = { method: ctx.request.method, url: ctx.request.url }
    return next()
  }

  /**
   * One request; with a signal, a poll's own, with the recorder. Never throws or rejects:
   * a liaise endpoint never does, but a hand-written Pollable that throws, rejects or
   * resolves with something other than a Result is reported, and becomes a middleware error.
   */
  private async call(signal?: AbortSignal): Promise<Result<unknown>> {
    try {
      const result = await this.endpoint(this.params, signal
        ? { ...this.callOptions, signal, middleware: [...(this.callOptions.middleware ?? []), this.record] }
        : this.callOptions)
      if (typeof result === 'object' && result !== null) return result
      throw new TypeError(`the endpoint resolved with ${String(result)}, not a Result`)
    } catch (error) {
      report(error, 'the endpoint')
      return createNetworkErrorResult(
        new ApiError({ kind: 'middleware', status: 0, statusText: '', body: error, headers: new Headers(), request: { method: this.request?.method ?? '', url: this.request?.url ?? '', params: this.params } }),
        () => this.call(),
      )
    }
  }

  private async ask(): Promise<void> {
    if (this.stopped) return
    this.clearTimer()
    const controller = new AbortController()
    this.controller = controller
    // Always at least one microtask: nothing is delivered inside the join() that started
    // this ask, so a caller always has its `leave` before its first Result.
    const result = await this.call(controller.signal)
    if (this.stopped) return // stopped while in flight: not delivered
    this.last = result
    this.failures = result.error ? this.failures + 1 : 0
    // The request stays "in flight" through delivery, so a callback that joins this
    // question can't start a second loop; schedule() ends it.
    for (const caller of [...this.callers]) if (this.callers.has(caller)) deliver(caller, result)
    this.controller = undefined
    this.schedule(result)
  }

  private schedule(result: Result<unknown>): void {
    this.retryAt = 0
    const repeating = [...this.callers].filter(c => !Number.isNaN(c.every))
    if (this.stopped || repeating.length === 0) return
    const every = Math.min(...repeating.map(c => c.every))
    const cap = Math.min(...repeating.map(c => c.maxEvery))
    let wait = every
    if (this.failures > 0) {
      // Jittered, never below `every`: a failure must never make the next poll sooner.
      const target = Math.min(every * 2 ** this.failures, cap)
      wait = every + Math.random() * Math.max(0, target - every)
      const status = result.error?.status
      if (status === 429 || status === 503) {
        // A hand-written Result may have a response without headers.
        const after = parseRetryAfter(result.response?.headers?.get?.('retry-after') ?? null)
        if (after !== null) {
          const held = Math.min(after, cap)
          // Remembered even while paused: a tab shown again waits out the rest of it.
          this.retryAt = Date.now() + held
          wait = Math.max(wait, held)
        }
      }
    }
    this.answeredAt = Date.now()
    this.wait = wait
    if (!this.paused()) this.arm(wait)
  }
}

/** A plain object, as classify-params.ts counts one: another realm's Object.prototype included. */
function isPlain(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null || Object.getPrototypeOf(proto as object) === null
}

const polls = new WeakMap<object, Map<string, SharedPoll>>()

/** Joins (or starts) the shared poll for this question. Internal: poll and pollUntil both use it. */
function join(
  endpoint: Pollable<object, unknown>,
  params: object,
  options: PollOptions,
  deliverTo: (result: Result<unknown>) => void,
): { leave: () => void; shared: SharedPoll } {
  // Mutating params after the call changes nothing: copy a plain object. Anything else
  // (Map, URLSearchParams, a binary body, a class with toJSON) goes through as it is.
  const snapshot = isPlain(params) ? { ...params } : params
  const callOptions = Object.fromEntries(Object.entries(options).filter(([k]) => !POLL_ONLY.has(k))) as CallOptions
  // Shared only where there is a `window`: browsers and React Native. The key is
  // decided here, before any middleware runs, so on a server, where one process
  // serves many users, a middleware that adds the current user's token would hand
  // one user's answers to another. There each caller gets a poll of its own. Only a
  // function can be a key; anything else gets its own poll, whose request fails.
  const shareable = typeof window !== 'undefined' && typeof endpoint === 'function'
  const paramsKey = shareable ? stableKey(snapshot) : null
  const optionsKey = paramsKey === null ? null : stableKey(callOptions)
  const key = paramsKey === null || optionsKey === null ? null : `${paramsKey}|${optionsKey}`
  let byKey = polls.get(endpoint)
  let shared = key === null ? undefined : byKey?.get(key)
  if (!shared) {
    shared = new SharedPoll(endpoint, snapshot, callOptions, poll => {
      if (key !== null && polls.get(endpoint)?.get(key) === poll) polls.get(endpoint)!.delete(key)
    })
    if (key !== null) {
      if (!byKey) polls.set(endpoint, (byKey = new Map()))
      byKey.set(key, shared)
    }
  }
  const every = positive(options.every)
  const maxEvery = positive(options.maxEvery)
  const caller: Caller = {
    every,
    maxEvery: Number.isNaN(maxEvery) ? Math.max(Number.isNaN(every) ? 0 : every, 60_000) : maxEvery,
    inBackground: options.inBackground === true,
    deliver: deliverTo,
  }
  return { leave: shared.join(caller), shared }
}

/**
 * Asks `endpoint` at once, then again `every` ms after each response, and hands
 * each Result to `callback` until `stop()`. In a browser or React Native, callers
 * asking the same thing share one poll; on a server (no `window`) each has its own.
 * Never throws.
 */
export function poll<P extends object, R>(
  endpoint: Pollable<P, R>,
  params: P,
  callback: (result: Result<R>) => void,
  options: PollOptions,
): () => void {
  let leave = (): void => {}
  try {
    const signal = options.signal
    if (signal?.aborted) return () => {}
    const stop = (): void => {
      leave()
      signal?.removeEventListener?.('abort', stop)
    }
    // Before joining: a signal that isn't one throws here, before anything is sent.
    signal?.addEventListener('abort', stop, { once: true })
    // A caller that asks once leaves after its answer, even beside callers that repeat,
    // so nothing it started is left running.
    const once = Number.isNaN(positive(options.every))
    ;({ leave } = join(endpoint as unknown as Pollable<object, unknown>, params, options, r => {
      if (once) stop()
      callback(r as Result<R>)
    }))
    return stop
  } catch (error) {
    // Untyped misuse, such as no options or a signal that isn't one: report it, stop
    // what it started, and hand back a stop that does nothing.
    report(error, 'poll()')
    leave()
    return () => {}
  }
}

/**
 * Errors waiting can't fix end pollUntil with that Result: a 4xx other than 408
 * and 429, a GraphQL `errors` response, a parse or middleware error, or a cancellation. Network errors, a
 * single request's timeout, 5xx, 408 and 429 keep it polling (with backoff).
 */
function endsPolling(kind: string, status: number): boolean {
  // A 2xx 'http' error is a GraphQL `errors` response: waiting doesn't fix it either.
  if (kind === 'http') return status < 300 || (status >= 400 && status < 500 && status !== 408 && status !== 429)
  return kind === 'parse' || kind === 'middleware' || kind === 'abort'
}

/**
 * Polls until `until` returns true for a successful Result, and resolves with it.
 * Also resolves — never rejects — with an error that waiting can't fix, a
 * `kind: 'timeout'` error after `giveUpAfter`, or `kind: 'abort'` when `signal`
 * aborts. Shares like `poll`.
 */
export function pollUntil<P extends object, R>(
  endpoint: Pollable<P, R>,
  params: P,
  options: PollUntilOptions<R>,
): Promise<Result<R>> {
  return new Promise(resolve => {
    let settled = false
    let leave = (): void => {}
    try {
      const { until, giveUpAfter, signal } = options
      const retry = (): Promise<Result<R>> => pollUntil(endpoint, params, options)
      let shared: SharedPoll | undefined
      let giveUp: ReturnType<typeof setTimeout> | undefined

      const own = (kind: 'timeout' | 'abort', body: unknown): Result<R> =>
        createNetworkErrorResult<R>(
          new ApiError({
            kind,
            status: 0,
            statusText: '',
            body,
            headers: new Headers(),
            request: { method: shared?.request?.method ?? '', url: shared?.request?.url ?? '', params },
          }),
          retry,
        )
      const finish = (result: Result<R>): void => {
        if (settled) return
        settled = true
        if (giveUp !== undefined) clearTimeout(giveUp)
        leave()
        resolve(result)
        // A signal-like object may have no removeEventListener; run from the giveUpAfter
        // timer, a throw here would be uncaught.
        signal?.removeEventListener?.('abort', onAbort)
      }
      const onAbort = (): void => finish(own('abort', signal!.reason))

      if (signal?.aborted) {
        resolve(own('abort', signal.reason))
        return
      }
      // A caller whose own `every` asks once gets the first Result, whatever it is.
      const asksOnce = Number.isNaN(positive(options.every))
      ;({ leave, shared } = join(endpoint as unknown as Pollable<object, unknown>, params, options, r => {
        const result = r as Result<R>
        if (result.error === null) {
          let done = false
          try {
            done = until(result)
          } catch (error) {
            report(error, 'until')
          }
          if (done || asksOnce) finish(result)
        } else if (asksOnce || endsPolling(result.error.kind, result.error.status)) {
          finish(result)
        }
      }))
      if (settled) {
        // Settled while joining: finish() ran before `leave` was assigned, so stop here.
        leave()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      // Above the longest timer (about 24.8 days) the delay would overflow and fire at once: no limit.
      if (typeof giveUpAfter === 'number' && Number.isFinite(giveUpAfter) && giveUpAfter > 0 && giveUpAfter <= MAX_TIMER) {
        giveUp = setTimeout(() => {
          const reason = new Error(`pollUntil gave up after ${giveUpAfter} ms`)
          reason.name = 'TimeoutError'
          finish(own('timeout', reason))
        }, giveUpAfter)
      }
    } catch (error) {
      report(error, 'pollUntil()')
      if (!settled) {
        settled = true
        leave()
        resolve(
          createNetworkErrorResult<R>(
            new ApiError({ kind: 'middleware', status: 0, statusText: '', body: error, headers: new Headers(), request: { method: '', url: '', params } }),
            () => pollUntil(endpoint, params, options),
          ),
        )
      }
    }
  })
}
