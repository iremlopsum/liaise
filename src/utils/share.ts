// =============================================================================
// share.ts — `share: true`: one network round trip for identical requests
// =============================================================================
// Sharing is decided at the last moment, inside core() (create-api.ts), on what
// is about to be sent (`requestKey`): name, method, final URL, final headers
// minus the tracing list, and body. Every caller has run its own pipeline to
// get there — setup, middleware, deadlines — and goes on to decode its own
// copy of the one read and build its own Result. Only the round trip is
// shared (`ShareTracker.run`).
//
// Two identical requests are byte-for-byte the same to the server, so sharing
// them is safe; anything that differs never shares.
//
// The rest supports the callers' own pipelines: a token that lets onError
// hear about one failed shared request once (`tagShared`/`shouldReport`), and
// a marker for a Result that joined instead of sending (`markJoined`).
// =============================================================================

import type { Exchange } from './exchange.js'
import { anySignal, releaseSignal } from './any-signal.js'

/**
 * The reason a shared request is aborted when its last caller gives up.
 *
 * Not a failure: the request is simply no longer wanted. Only a caller that
 * has already gone could ever see it, and `run` has already released every
 * one of them by then, so the outcome of an abandoned request reaches no
 * caller's pipeline and is never reported. A sentinel rather than any one
 * caller's reason, because it answers why the REQUEST ended, not why the last
 * caller left.
 */
export const ABANDONED: unique symbol = Symbol('liaise.abandoned')

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

/**
 * What a caller learns the moment it enters a round trip, before it can give
 * up — so even a caller that leaves early knows which round trip it was
 * waiting on.
 */
export interface Entered {
  /** Identity of the round trip: tags an error derived from its outcome. */
  token: object
  /**
   * A second identity for the same round trip, for its deadline: tags every
   * caller's timeout to the endpoint's (or client's) deadline, the shared
   * request's own or a caller's copy of it. Kept apart from `token` so that a
   * caller's early timeout cannot use up the report for a real failure (a
   * 500, a network error) that a caller still waiting receives later.
   */
  deadlineToken: object
  /** True when this caller joined a request someone else sent. */
  joined: boolean
}

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
  /** Identity of the round trip's deadline (see `Entered.deadlineToken`). */
  deadlineToken: object
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
 * Joins identical concurrent requests onto one round trip.
 *
 * Sibling of `DedupeTracker`, with the opposite intent: dedupe cancels the
 * older request, share joins the existing one.
 *
 * Each caller holds a reference. A caller that gives up releases its
 * reference and the shared request continues for everyone else; only when the
 * last reference is released is the request aborted (with `ABANDONED`). One
 * component unmounting must never cancel a request nine others are waiting on.
 */
export class ShareTracker {
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
   *
   * `onEnter`, when given, is called synchronously as this caller takes its
   * reference — before the returned promise can settle either way — with the
   * round trip's tokens. A caller rejected because its signal was already
   * aborted never enters, and `onEnter` is not called. If `onEnter` throws,
   * this caller leaves again at once (abandoning the request if it was the
   * only caller) and the returned promise rejects with what it threw.
   */
  run(
    key: string,
    deadline: () => AbortSignal | undefined,
    callerSignal: AbortSignal | undefined,
    send: (signal: AbortSignal) => Promise<Exchange>,
    onEnter?: (entered: Entered) => void
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
      const created: RunEntry = {
        controller, signal, refs: 0, settled: false, token: {}, deadlineToken: {},
        promise: undefined as unknown as Promise<SharedOutcome>,
      }
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
    if (onEnter) {
      // A throw here would otherwise leave this caller's reference behind:
      // an entry that can never be abandoned, holding a request open for
      // nobody. Give the reference back and fail this caller alone.
      try {
        onEnter({ token: held.token, deadlineToken: held.deadlineToken, joined })
      } catch (err) {
        this.leave(key, held)
        return Promise.reject(err)
      }
    }

    return new Promise<Shared>((resolve, reject) => {
      let done = false
      const onAbort = (): void => {
        if (done) return
        done = true
        this.leave(key, held)
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
   * One caller gives its reference back. The last one to leave a request
   * that has not settled abandons it: the entry leaves the map at once — a
   * `send` that ignores its signal would otherwise keep it (and its key, which
   * holds body text) there — and the request is aborted with `ABANDONED`.
   */
  private leave(key: string, held: RunEntry): void {
    held.refs--
    if (held.refs <= 0 && !held.settled) {
      if (this.runs.get(key) === held) this.runs.delete(key)
      if (!held.controller.signal.aborted) held.controller.abort(ABANDONED)
    }
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
}
