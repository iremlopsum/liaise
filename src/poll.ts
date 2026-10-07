// =============================================================================
// poll.ts — ask an endpoint again on an interval, one shared poll per question
// =============================================================================
//
// Standalone, like paginate: it costs nothing unless imported. Callers that ask
// the same thing — the same endpoint function, params and per-request options —
// share one poll: one request per tick, every Result to all of them. Spec:
// docs/superpowers/specs/2026-10-07-polling-design.md (local).
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
   * Milliseconds to wait after each response before asking again. A value that
   * isn't a positive finite number asks once and never repeats.
   */
  every: number
  /** Keep polling while the browser tab is hidden. Default `false`: pause, and ask at once when it's visible again. */
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
 * A thrown callback or `until` never breaks the poll. Like an EventTarget listener's
 * error it goes to `reportError` (browsers, Deno, Bun); where there is none it's
 * logged. Never re-thrown later: in Node an async throw would crash the process.
 */
function report(error: unknown): void {
  const g = globalThis as { reportError?: (error: unknown) => void }
  if (typeof g.reportError === 'function') g.reportError(error)
  else console.error('[liaise] a poll callback threw:', error)
}

function deliver(caller: Caller, result: Result<unknown>): void {
  try {
    caller.deliver(result)
  } catch (error) {
    report(error)
  }
}

/** The document, looked up when needed (tests stub it), or undefined where there is none. */
function page(): Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | undefined {
  return typeof document === 'undefined' ? undefined : document
}

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
  private readonly onVisibility = (): void => this.visibilityChanged()

  constructor(
    private readonly endpoint: Pollable<object, unknown>,
    private readonly params: object,
    private readonly callOptions: CallOptions,
    private readonly forget: (poll: SharedPoll) => void,
  ) {}

  join(caller: Caller): () => void {
    const first = this.callers.size === 0
    this.callers.add(caller)
    if (first) {
      page()?.addEventListener('visibilitychange', this.onVisibility)
      if (!this.paused()) void this.ask()
    } else {
      const last = this.last
      if (last) queueMicrotask(() => { if (this.callers.has(caller)) deliver(caller, last) })
      // A joiner can make an idle poll ask again: an inBackground caller in a hidden
      // tab, or a repeating caller joining a poll that asked once.
      if (!this.controller && this.timer === undefined && !this.paused() && (this.repeats() || !last)) void this.ask()
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
    page()?.removeEventListener('visibilitychange', this.onVisibility)
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
    else if (!this.controller && this.timer === undefined && (this.repeats() || !this.last)) void this.ask()
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private async ask(): Promise<void> {
    this.clearTimer()
    const controller = new AbortController()
    this.controller = controller
    // Innermost and passive: records what is sent, so pollUntil's own results can
    // name the attempt. Runs after every user middleware and leaves ctx alone.
    const record: Middleware = (ctx, next) => {
      this.request = { method: ctx.request.method, url: ctx.request.url }
      return next()
    }
    let result: Result<unknown>
    try {
      result = await this.endpoint(this.params, {
        ...this.callOptions,
        signal: controller.signal,
        middleware: [...(this.callOptions.middleware ?? []), record],
      })
    } catch (error) {
      // A liaise endpoint never throws; a hand-written Pollable might.
      report(error)
      result = createNetworkErrorResult(
        new ApiError({ kind: 'middleware', status: 0, statusText: '', body: error, headers: new Headers(), request: { method: this.request?.method ?? '', url: this.request?.url ?? '', params: this.params } }),
        () => this.endpoint(this.params, this.callOptions),
      )
    }
    if (this.stopped || controller.signal.aborted) return // stopped while in flight: not delivered
    this.controller = undefined
    this.last = result
    this.failures = result.error ? this.failures + 1 : 0
    for (const caller of [...this.callers]) deliver(caller, result)
    this.schedule(result)
  }

  private schedule(result: Result<unknown>): void {
    if (this.stopped || this.paused()) return
    const repeating = [...this.callers].filter(c => !Number.isNaN(c.every))
    if (repeating.length === 0) return
    const every = Math.min(...repeating.map(c => c.every))
    const cap = Math.min(...repeating.map(c => c.maxEvery))
    let wait = every
    if (this.failures > 0) {
      // Jittered, never below `every`: a failure must never make the next poll sooner.
      const target = Math.min(every * 2 ** this.failures, cap)
      wait = every + Math.random() * Math.max(0, target - every)
      const status = result.error?.status
      if (status === 429 || status === 503) {
        const after = parseRetryAfter(result.response?.headers.get('retry-after') ?? null)
        if (after !== null) wait = Math.max(wait, Math.min(after, cap))
      }
    }
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.ask()
    }, wait)
  }
}

const polls = new WeakMap<object, Map<string, SharedPoll>>()

/** Joins (or starts) the shared poll for this question. Internal: poll and pollUntil both use it. */
function join(
  endpoint: Pollable<object, unknown>,
  params: object,
  options: PollOptions,
  deliverTo: (result: Result<unknown>) => void,
): { leave: () => void; shared: SharedPoll } {
  const snapshot = { ...params } // mutating params after the call changes nothing
  const callOptions = Object.fromEntries(Object.entries(options).filter(([k]) => !POLL_ONLY.has(k))) as CallOptions
  const paramsKey = stableKey(snapshot)
  const optionsKey = stableKey(callOptions)
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
 * each Result to `callback` until `stop()`. Callers asking the same thing share
 * one poll. Never throws.
 */
export function poll<P extends object, R>(
  endpoint: Pollable<P, R>,
  params: P,
  callback: (result: Result<R>) => void,
  options: PollOptions,
): () => void {
  const signal = options.signal
  if (signal?.aborted) return () => {}
  const { leave } = join(endpoint as unknown as Pollable<object, unknown>, params, options, r => callback(r as Result<R>))
  if (!signal) return leave
  const onAbort = (): void => leave()
  signal.addEventListener('abort', onAbort, { once: true })
  return () => {
    signal.removeEventListener('abort', onAbort)
    leave()
  }
}
