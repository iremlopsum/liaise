import type { Result } from '../types.js'
import type { Exchange } from './exchange.js'
import { anySignal, releaseSignal } from './any-signal.js'

interface Entry {
  promise: Promise<Result<unknown>>
  controller: AbortController
  refs: number
  /**
   * Whether the operation has produced a `Result` yet.
   *
   * Set by the operation itself, synchronously, before it reports anything —
   * which is the only moment at which this is knowable. Every hop downstream
   * of that (this class's own `.finally`, a sharer's `.then`) runs strictly
   * later, so a flag set there is always still false during the window that
   * matters. See `hasSettled`.
   */
  settled: boolean
}

/**
 * The reason a shared request is aborted when its last caller releases.
 *
 * This is not a failure — the underlying request is simply no longer wanted,
 * not the operation ended in error. Reporting it again as an operation
 * failure is what made a single shared timeout produce two `onError` calls
 * before 2.2.1. (It is not true that every caller has already *reported* its
 * own give-up, only that it has already *received* its own Result: since
 * Task 10, `onError` never fires for `error.kind === 'abort'` at all, so a
 * plain abort-flavoured give-up reports zero times, not one. What matters
 * here is narrower — this sentinel is what lets create-api.ts's own
 * post-execution hook recognise "nobody is waiting" and not report the
 * operation's own outcome as a second, misleading failure.)
 */
export const ABANDONED: unique symbol = Symbol('liaise.abandoned')

/** Whether an abort reason is the tracker's own abandonment sentinel. */
export function isAbandoned(reason: unknown): boolean {
  return reason === ABANDONED
}

/**
 * Headers that identify a request for tracing and never change the server's
 * answer. Left out of the share key; otherwise a middleware stamping a unique
 * ID on every call would silently stop all sharing. The shared request goes
 * out with the first caller's values. Fixed on purpose (spec §3.3).
 */
export const TRACING_HEADERS: ReadonlySet<string> = new Set([
  'traceparent', 'tracestate', 'baggage', 'sentry-trace', 'x-request-id', 'x-correlation-id',
])

/**
 * The share key: what this request would put on the wire. Two requests with
 * the same key are byte-for-byte the same to the server, so sharing them is
 * safe; anything that differs never shares. `null` means the body can't be
 * compared cheaply and safely (an upload), so the call is never shared.
 */
export function requestKey(name: string, method: string, url: string, headers: Headers, body: unknown): string | null {
  let bodyKey: unknown
  if (body === null || body === undefined) bodyKey = null
  else if (typeof body === 'string') bodyKey = ['s', body]
  else if (body instanceof URLSearchParams) bodyKey = ['u', body.toString()]
  else return null

  const pairs: [string, string][] = []
  headers.forEach((value, key) => {
    if (!TRACING_HEADERS.has(key)) pairs.push([key, value])
  })
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return JSON.stringify([name, normalizeMethod(method), url, pairs, bodyKey])
}

/**
 * Mirrors Fetch: only these methods are case-normalised, so `patch` and
 * `PATCH` (which Fetch sends differently) never share a key.
 */
function normalizeMethod(method: string): string {
  return /^(?:delete|get|head|options|post|put)$/i.test(method) ? method.toUpperCase() : method
}

/** What one shared round trip produced. Never a rejection: a failed send is `ok: false`. */
export type SharedOutcome = { ok: true; exchange: Exchange } | { ok: false; error: unknown }

/** One caller's view of a shared round trip. */
export interface Shared {
  outcome: SharedOutcome
  /** Identity of the round trip — every caller of it gets the same object. */
  token: object
  /** True when this caller joined a request someone else sent. */
  joined: boolean
}

interface RunEntry {
  /** The round trip's outcome. Never rejects: both arms are mapped. */
  promise: Promise<SharedOutcome>
  /** Aborted with ABANDONED when the last caller gives up. */
  controller: AbortController
  /** What `send` was given: the controller's signal merged with the leader's deadline. */
  signal: AbortSignal
  /** Callers still waiting. */
  refs: number
  /** Whether the outcome is known. Entries leave the map the moment it is, so this is defence. */
  settled: boolean
  /** Identity of the round trip, shared by every caller's result. */
  token: object
}

const sharedTokens = new WeakMap<object, object>()
const joinedResults = new WeakSet<object>()

/** Marks an error as derived from the shared round trip `token`. */
export function tagShared(error: object, token: object): void {
  sharedTokens.set(error, token)
}

/** Marks a Result as having joined a request someone else sent (the logger's `, shared`). */
export function markJoined(result: object): void {
  joinedResults.add(result)
}

/** Whether `markJoined` was called on this Result. */
export function wasJoined(result: object): boolean {
  return joinedResults.has(result)
}

/**
 * Joins identical concurrent requests onto one in-flight call.
 *
 * Sibling of `DedupeTracker`, with the opposite intent: dedupe cancels the
 * older request, share joins the existing one.
 *
 * Each caller holds a reference. A caller that gives up releases its
 * reference and the shared request continues for everyone else; only when the
 * last reference is released is the underlying request aborted. One component
 * unmounting must never cancel a request nine others are waiting on.
 */
export class ShareTracker {
  private inflight = new Map<string, Entry>()

  private runs = new Map<string, RunEntry>()
  private reported = new WeakSet<object>()

  /**
   * Send `key`'s request, or join an identical one already in flight.
   *
   * The first caller (the leader) calls `send` with a signal that aborts only
   * when every caller has given up (ABANDONED) or the leader's `deadline()`
   * fires — never on the leader's own signal: the leader giving up must not
   * cancel the request for anyone else. `deadline` is called only by the
   * leader, so the shared deadline is measured from when the request was sent.
   *
   * A caller whose `callerSignal` aborts first is released and the returned
   * promise rejects with that signal's reason; everyone else keeps waiting.
   * A settled entry is never joined: a call arriving after the answer starts
   * a fresh request (no caching).
   */
  run(
    key: string,
    deadline: () => AbortSignal | undefined,
    callerSignal: AbortSignal | undefined,
    send: (signal: AbortSignal) => Promise<Exchange>
  ): Promise<Shared> {
    // A caller that has already given up must not start (or join) anything.
    if (callerSignal?.aborted === true) return Promise.reject(callerSignal.reason)
    let entry = this.runs.get(key)
    // entry.signal covers the controller (abandonment), the leader's deadline,
    // and a deadline() that came back already aborted.
    if (entry && (entry.settled || entry.refs <= 0 || entry.signal.aborted)) entry = undefined
    const joined = entry !== undefined

    if (!entry) {
      const controller = new AbortController()
      const limit = deadline()
      // Always defined: controller.signal is one of the inputs. With no limit,
      // anySignal returns it unchanged; otherwise a merged signal that carries
      // the aborting input's reason (so a TimeoutError stays a TimeoutError).
      const signal = anySignal([controller.signal, limit]) as AbortSignal
      const created: RunEntry = { controller, signal, refs: 0, settled: false, token: {}, promise: undefined as unknown as Promise<SharedOutcome> }
      // `send` may throw synchronously; the async wrapper turns that into a
      // rejection so it lands in the same ok:false arm. That is what keeps
      // `created.promise` from ever rejecting, so nothing downstream can
      // produce an unhandled rejection.
      // Settling, leaving the map and releasing the signal all happen in the
      // same step, so no observer can ever see a settled entry in the map.
      const settle = (outcome: SharedOutcome): SharedOutcome => {
        created.settled = true
        if (this.runs.get(key) === created) this.runs.delete(key)
        releaseSignal(signal)
        return outcome
      }
      created.promise = (async () => send(signal))().then(
        (exchange): SharedOutcome => settle({ ok: true, exchange }),
        (error: unknown): SharedOutcome => settle({ ok: false, error })
      )
      this.runs.set(key, created)
      entry = created
    }

    const held = entry
    held.refs++

    return new Promise<Shared>((resolve, reject) => {
      let done = false
      const onAbort = (): void => {
        if (done) return
        done = true
        held.refs--
        if (held.refs <= 0 && !held.settled) {
          // Drop the entry now: a `send` that ignores its signal would
          // otherwise leave it (and its key, which holds body text) in the map.
          if (this.runs.get(key) === held) this.runs.delete(key)
          if (!held.controller.signal.aborted) held.controller.abort(ABANDONED)
        }
        reject(callerSignal!.reason)
      }
      if (callerSignal?.aborted === true) {
        onAbort()
        return
      }
      callerSignal?.addEventListener('abort', onAbort, { once: true })
      void held.promise.then(outcome => {
        if (done) return
        done = true
        callerSignal?.removeEventListener('abort', onAbort)
        resolve({ outcome, token: held.token, joined })
      })
    })
  }

  /**
   * Whether `onError` should hear about this error: always for an error not
   * derived from a shared round trip, and once per round trip otherwise —
   * every caller of one failed shared request gets its own error object, all
   * tagged with the same token.
   */
  shouldReport(error: object): boolean {
    const token = sharedTokens.get(error)
    if (token === undefined) return true
    if (this.reported.has(token)) return false
    this.reported.add(token)
    return true
  }

  /**
   * Join the in-flight request for `key`, or start one with `exec`.
   *
   * @param key - Identity of the call; identical keys share.
   * @param exec - Starts the real request. Called only for the first caller,
   *   and given the shared signal to pass to `fetch`, plus a `markSettled`
   *   callback it must invoke the moment it has a `Result` — before it reports
   *   that Result anywhere.
   * @returns The shared promise, a `release` this caller must call if it gives
   *   up waiting, and `hasSettled` — a synchronous reader every sharer of this
   *   operation shares, not a per-caller closure.
   */
  acquire(
    key: string,
    exec: (signal: AbortSignal, markSettled: () => void) => Promise<Result<unknown>>
  ): { promise: Promise<Result<unknown>>; release: () => boolean; hasSettled: () => boolean } {
    let entry = this.inflight.get(key)

    // A dying entry: every sharer has already released (refs <= 0) or its
    // controller has already been aborted, but the `.finally()` cleanup
    // below has not run yet — that only happens once the real request's
    // promise actually settles, at least one microtask after a synchronous
    // `controller.abort()`. Joining it here would hand this caller a
    // synthetic abort result instead of a real request, e.g.:
    //
    //   controller.abort()      // last sharer releases; refs -> 0, aborts
    //   api.get(params)         // no await in between — must NOT join this
    //
    // No third, synchronous flag is needed to close that window: `release`
    // decrements `refs` unconditionally, before it ever calls `abort()`, so
    // `refs <= 0` is already true for any caller arriving synchronously
    // during (or after) that abort call — including one arriving from
    // *inside* an `abort` event listener the call triggers, since
    // `AbortController.abort()` sets `signal.aborted` before it fires any
    // listeners. Both were verified empirically: forcing a would-be "dead"
    // marker to be set after `abort()` instead of before never changed a
    // single test's outcome, in this guard or in a listener-nested re-entry.
    //
    // Treat it as if no entry exists so a fresh one is started instead.
    if (entry && (entry.refs <= 0 || entry.controller.signal.aborted)) {
      entry = undefined
    }

    if (!entry) {
      const controller = new AbortController()
      const created: Entry = {
        controller,
        refs: 0,
        settled: false,
        promise: undefined as unknown as Promise<Result<unknown>>,
      }
      created.promise = exec(controller.signal, () => { created.settled = true }).finally(() => {
        // Identity check: only clear the entry if it is still ours. An entry
        // replaced while this one was settling belongs to a newer call, and
        // deleting it would silently disable sharing for that key — the same
        // class of bug fixed in DedupeTracker.clear() in 2.1.0.
        if (this.inflight.get(key) === created) this.inflight.delete(key)
      })
      this.inflight.set(key, created)
      entry = created
    }

    entry.refs++
    const held = entry
    let released = false

    return {
      promise: held.promise,
      // Per-operation, so a joiner sees it too — the give-up this guards
      // against can arrive on any sharer's signal, not just the first one's.
      hasSettled: (): boolean => held.settled,
      // Returns whether THIS call was the one that dropped refs to zero and
      // aborted the shared controller. It is part of the tracker's own
      // contract (tests/share-tracker.test.ts asserts it), not a signal for
      // the caller to decide reporting by: create-api.ts's call site is
      // `if (!hasSettled()) fireOnError(...)`, not unconditional, and
      // `fireOnError` itself drops anything with `error.kind === 'abort'`
      // regardless. The ABANDONED reason below serves a narrower purpose —
      // it is what keeps the shared request's OWN post-execution hook quiet
      // about an outcome that is nobody's failure, not what decides whether
      // any individual caller's give-up gets reported.
      release: (): boolean => {
        if (released) return false
        released = true
        held.refs--
        if (held.refs <= 0 && !held.controller.signal.aborted) {
          // The shared controller's abort reason answers exactly one
          // question: why did the OPERATION end? The answer here is always
          // the same — nobody is waiting on it any more — so the reason is
          // always ABANDONED, never the reason of whichever caller happened
          // to release last.
          //
          // Each caller's own Result is classified separately, at the share
          // site, from that caller's own `perCaller.reason`. Conflating the
          // two is what made a single shared timeout report twice: the last
          // caller's reason travelled into the shared request, whose
          // post-execution hook then reported it again as an operation
          // failure. Keeping them apart is what lets that hook recognise
          // abandonment (`isAbandoned`) and stay silent.
          held.controller.abort(ABANDONED)
          return true
        }
        return false
      },
    }
  }
}
