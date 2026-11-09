// =============================================================================
// pager.ts — a page of results that a UI shows, moves and subscribes to
// =============================================================================
//
// Standalone, like paginate and poll: it costs nothing unless imported. Where
// `paginate` walks every page once, a pager holds the one page a screen shows,
// and moves: to a page number, to the next or previous page, or to new base
// params (a filter change). It keeps a frozen state snapshot and tells
// subscribers when it changes, the shape React's `useSyncExternalStore`, a Vue
// `ref` and a Svelte store each wrap in a few lines.
//
// Not a third pipeline. Every request is one ordinary call of the endpoint it
// was given (a `createApi` method or a `createGraphQL` operation, structurally a
// `Pollable`), with the caller's `CallOptions` and a signal. Middleware, retry,
// timeouts, `share` and the `log` option all apply exactly as they would to a
// direct call, because it is one.
//
// Latest wins, per pager instance. Each move aborts the request this pager
// started for the move before it, through that request's own `signal`, and a
// token makes sure a reply to a superseded move never touches the state, even
// from an endpoint that ignores its signal. That is deliberately not `dedupe`,
// which cancels per operation: two pagers over the same endpoint, a `paginate`
// walk and a plain call never cancel each other, because the pager only aborts
// what it started.
//
// Spec: docs/superpowers/specs/2026-11-09-pager-design.md (local).
// =============================================================================

import type { CallOptions, Result, SuccessResult } from './types.js'
import type { Pollable } from './poll.js'
import { ApiError, createNetworkErrorResult } from './result.js'
import { anySignal, releaseSignal } from './utils/any-signal.js'
import { report } from './utils/report.js'
import { stableKey } from './utils/stable-key.js'

/** Options every pager takes, plus any `CallOptions`, which go with every request. */
export interface PagerBaseOptions extends Omit<CallOptions, 'signal'> {
  /**
   * Stops the pager: aborts what's in flight. Every later move resolves with a
   * `kind: 'abort'` error whose `body` is the signal's reason, and sends nothing.
   */
  signal?: AbortSignal
  /** Keep visited pages, so going back shows them without a request. Default `true`. */
  cache?: boolean
}

/** A pager over page numbers: any page can be opened directly. */
export interface NumberedPagerOptions<P, R> extends PagerBaseOptions {
  /** The params for 1-based `page`, built from the base params (the ones `setParams` replaces). */
  toParams: (page: number, params: P) => P
  /**
   * How many pages there are, read from a result. Without it, or when it returns
   * nullish, `pageCount` is `null` and `hasNext` stays `true`.
   */
  pageCount?: (result: SuccessResult<R>) => number | null | undefined
  /** The page `load()` opens. Default `1`. */
  start?: number
}

/** A pager over cursors: pages are reached one after another. */
export interface CursorPagerOptions<P, R> extends PagerBaseOptions {
  /** The params of the page after `result`, or nullish when it's the last. The same `next` `paginate` takes. */
  next: (result: SuccessResult<R>, params: P) => P | null | undefined
  /** The params of the page before `result`, for APIs that return a previous cursor. */
  prev?: (result: SuccessResult<R>, params: P) => P | null | undefined
  /** The params of the page `load()` opens when it isn't the first (a cursor from the URL). */
  from?: P
}

/** Turns a pager into one growing list (infinite scroll). */
export interface ListOptions<R, T> {
  /** The items of one page. liaise never guesses which field holds them. */
  items: (result: SuccessResult<R>) => readonly T[]
  /** How many pages `load()` fetches, from the first. Default `1`. */
  restore?: number
}

/** Options for `createPager`: `toParams` makes it numbered, `next` makes it cursor-based, `items` makes it a list. */
export type PagerOptions<P, R, T = never> =
  | NumberedPagerOptions<P, R> | CursorPagerOptions<P, R>
  | (NumberedPagerOptions<P, R> & ListOptions<R, T>) | (CursorPagerOptions<P, R> & ListOptions<R, T>)

/** A pager's snapshot. The same frozen object until something changes. */
export interface PagerState<P, R, T = never> {
  /** A move is waiting for its reply. */
  readonly loading: boolean
  /** The 1-based page `data` belongs to; `null` before `load()`, or when unknown (a cursor from `from`). */
  readonly page: number | null
  /** The page a move is loading; `null` when idle or unknown. */
  readonly target: number | null
  /** The params that loaded `data`: what the app writes to the URL. */
  readonly params: P | null
  /** The shown page. Stays the previous page while the next loads, and on error. */
  readonly data: R | null
  /** The last move's error; cleared by the next success. */
  readonly error: ApiError | null
  readonly pageCount: number | null
  readonly hasNext: boolean
  readonly hasPrev: boolean
  /** List mode: every page's items, in order. `[]` otherwise. */
  readonly items: readonly T[]
  /** List mode: how many pages `items` holds (persist this for `restore`). `0` otherwise. */
  readonly loaded: number
}

/**
 * A pager. Every move resolves with the `Result` it showed (or the one that
 * failed), or `null` when it can't go anywhere and sent nothing. It never throws
 * or rejects. A move superseded by a newer one resolves with the endpoint's own
 * `kind: 'abort'` Result, and never changes `state`.
 */
export interface Pager<P, R, T = never> {
  readonly state: PagerState<P, R, T>
  /** `listener` is called with no arguments after each change. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** Opens the pager. Creating one sends nothing. */
  load(): Promise<Result<R> | null>
  /** Cursor pages: only a page already shown, and only when numbers are known (not after `from`). */
  goTo(page: number): Promise<Result<R> | null>
  /**
   * The page after the one shown, or after the one loading, so two quick clicks move two pages.
   * Cursor pages: after the one loading only once it has named its next page.
   */
  next(): Promise<Result<R> | null>
  prev(): Promise<Result<R> | null>
  /** Fetches the current page again, past the cache, and replaces its entry. */
  refresh(): Promise<Result<R> | null>
  /** New base params (a filter change): forgets the cache (and cursor history) and opens page 1, never `from`. */
  setParams(params: P): Promise<Result<R> | null>
}

/** Every option a pager may get, for reading them apart from the `CallOptions`. */
type AnyOptions<P, R, T> = PagerBaseOptions & Partial<NumberedPagerOptions<P, R>> &
  Partial<Omit<CursorPagerOptions<P, R>, 'next'>> & { next?: unknown } & Partial<ListOptions<R, T>>

type Writable<S> = { -readonly [K in keyof S]: S[K] }

/** A cursor page the pager knows the params of. */
interface Step<P, R> {
  params: P
  /** It has been shown, so `goTo` may return to it. */
  seen: boolean
  /** Its cache entry (only when caching). */
  entry?: Entry<P, R>
  /** The previous page's params, read by `prev` when this step opened at `from` and is the earliest. */
  before?: P | null | undefined
}

/** A page this pager has shown: what it showed, and what it read from it. */
interface Entry<P, R> {
  result: SuccessResult<R>
  params: P
  count: number | null
}

const NONE: readonly never[] = Object.freeze([])

/** Whether two params are the same request params; unkeyable ones never are. */
function sameParams(a: unknown, b: unknown): boolean {
  const key = stableKey(a)
  return key !== null && key === stableKey(b)
}

/** A page count the state can hold: a whole number of at least 0, or null. */
function countOf(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

/**
 * Creates a pager over `endpoint`. Sends nothing until `load()`.
 *
 * @param endpoint - Any `createApi` method or `createGraphQL` operation.
 * @param params - The base params: what `toParams` builds each page's params from.
 * @param options - `toParams` (numbered pages) or `next` (cursor pages), plus any `CallOptions` for every request.
 */
export function createPager<P extends object, R, T = never>(
  endpoint: Pollable<P, R>, params: P, options: PagerOptions<P, R, T>,
): Pager<P, R, T> {
  const {
    toParams, pageCount: readCount, start = 1, cache = true, signal: stop,
    next: readNext, prev: readPrev, from: opening, items: _items, restore: _restore,
    ...callOptions
  } = (options ?? {}) as AnyOptions<P, R, T>

  // A mistake in the options is a Result on every move, never a throw here.
  // A `signal` that isn't one (plain JS) would throw inside anySignal: refuse it here.
  const problem: string | undefined =
    stop !== undefined && typeof (stop as { addEventListener?: unknown } | null)?.addEventListener !== 'function'
      ? 'createPager: signal must be an AbortSignal'
      : typeof toParams === 'function' || typeof readNext === 'function'
      ? (_items !== undefined ? 'createPager: list mode (items) is not supported yet' : undefined)
      : 'createPager needs toParams (numbered pages) or next (cursor pages)'
  // `toParams` wins when both are given.
  const cursor = typeof toParams !== 'function' && typeof readNext === 'function'

  const listeners = new Set<() => void>()
  const visited = new Map<number, Entry<P, R>>()
  // Cursor mode. Pages are reached one after another, so the pager keeps every
  // step it knows the params of: the visited ones, plus the next one each landed
  // page names. A step's place in `history` is its index, and the cache lives on
  // the step, so prepending a step (Previous from a `from` start) shifts both.
  let history: Step<P, R>[] = []
  // The step `load()` opens: the first page, or the one `from` names.
  let opened: Step<P, R> | undefined
  // Whether history[0] is the first page, so page numbers are known (not after `from`).
  let numberedSteps = true
  // Whether `opened` was the first page, for starting over at it.
  let openedNumbered = true
  let shownAt: number | null = null
  // The step a cursor move is loading; read only while `state.loading`.
  let loadingAt = 0
  let base = params
  // Bumped by every move; a reply applies only while its move's token is current.
  let token = 0
  // The current move's own controller: the only request this pager ever aborts.
  let controller: AbortController | undefined
  let state: PagerState<P, R, T> = Object.freeze({
    loading: false, page: null, target: null, params: null, data: null, error: null,
    pageCount: null, hasNext: false, hasPrev: false, items: NONE, loaded: 0,
  })

  /** Replaces the snapshot and notifies, unless nothing changed: then it stays the same object. */
  function set(patch: Partial<Writable<PagerState<P, R, T>>>): void {
    const next = { ...state, ...patch }
    if ((Object.keys(next) as (keyof typeof next)[]).every(key => next[key] === state[key])) return
    state = Object.freeze(next)
    // A copy: a listener that subscribes, or unsubscribes and subscribes again,
    // during this run is not called for this change, and can't loop it. One
    // removed during the run is skipped.
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue
      try {
        listener()
      } catch (error) {
        report(error, 'pager: a listener')
      }
    }
  }

  /**
   * A Result the endpoint didn't produce: a thrown callback, a bad option, a stop,
   * or an endpoint that broke its contract. Its `retry` resolves with itself, since
   * asking again changes nothing, unless `retry` is given (the endpoint's case).
   */
  function own(kind: 'middleware' | 'abort', body: unknown, sent: P, retry?: () => Promise<Result<R>>): Result<R> {
    const result: Result<R> = createNetworkErrorResult<R>(
      new ApiError({ kind, status: 0, statusText: '', body, headers: new Headers(), request: { method: '', url: '', params: sent } }),
      retry ?? (async () => result),
    )
    return result
  }

  /** `result` when it is the abort for `reason`, else an abort Result the pager builds. */
  function aborted(result: Result<R>, reason: unknown, sent: P): Result<R> {
    return result.error?.kind === 'abort' && result.error.body === reason ? result : own('abort', reason, sent)
  }

  /** A move that failed before sending anything: it still supersedes, and its error shows. */
  function failed(body: unknown, sent: P): Result<R> {
    supersede()
    const result = own('middleware', body, sent)
    set({ loading: false, target: null, error: result.error })
    return result
  }

  /**
   * One request. Never throws or rejects: a liaise endpoint never does, but a
   * hand-written one that throws, rejects or resolves with something other than
   * a Result is reported, and becomes a middleware error (as in poll).
   */
  async function call(sent: P, signal: AbortSignal | undefined): Promise<Result<R>> {
    try {
      const result = await endpoint(sent, { ...callOptions, signal })
      if (typeof result === 'object' && result !== null) return result
      throw new TypeError(`the endpoint resolved with ${String(result)}, not a Result`)
    } catch (error) {
      report(error, 'pager: the endpoint')
      return own('middleware', error, sent, () => call(sent, stop))
    }
  }

  /** Starts a new move: aborts the one before it and makes its reply stale. */
  function supersede(): number {
    controller?.abort(new DOMException('Superseded by a newer move', 'AbortError'))
    controller = undefined
    return ++token
  }

  /** What a move resolves with before anything else, or undefined when it may go ahead. */
  function refused(): Result<R> | undefined {
    if (problem !== undefined) {
      const result = own('middleware', new TypeError(problem), base)
      set({ error: result.error })
      return result
    }
    if (stop?.aborted) return own('abort', stop.reason, base)
    return undefined
  }

  function show(page: number, entry: Entry<P, R>): void {
    set({
      loading: false, target: null, page, params: entry.params, data: entry.result.data, error: null,
      pageCount: entry.count, hasNext: entry.count === null || page < entry.count, hasPrev: page > 1,
    })
  }

  /** Whether `page` can be asked for: a whole number from 1, within a known count. */
  function inRange(page: number): boolean {
    const count = state.pageCount
    return Number.isInteger(page) && page >= 1 && (count === null || page <= Math.max(count, 1))
  }

  /** Opens numbered `page`: from the cache unless `fresh`, else with a request. */
  function visit(page: number, fresh: boolean): Promise<Result<R> | null> {
    // `visited` is only filled when caching, so `cache: false` never hits.
    const hit = fresh ? undefined : visited.get(page)
    if (hit) {
      supersede()
      show(page, hit)
      return Promise.resolve(hit.result)
    }
    let sent: P
    try {
      sent = (toParams as NumberedPagerOptions<P, R>['toParams'])(page, base)
    } catch (error) {
      return Promise.resolve(failed(error, base))
    }
    const mine = supersede()
    const move = new AbortController()
    controller = move
    set({ loading: true, target: page })
    // A listener can start a newer move during that notification: then this one
    // is superseded before it sent anything, and sends nothing.
    if (mine !== token) return Promise.resolve(own('abort', move.signal.reason, sent))
    return settle(sent, move, mine, result => {
      let count: number | null
      try {
        count = readCount ? countOf(readCount(result)) : null
      } catch (error) {
        return failed(error, sent)
      }
      const entry: Entry<P, R> = { result, params: sent, count }
      if (cache) visited.set(page, entry)
      show(page, entry)
      return result
    })
  }

  /** Sends a move's request and, while it is still the current move, lands a success with `land`. */
  async function settle(
    sent: P, move: AbortController, mine: number, land: (result: SuccessResult<R>) => Result<R>,
  ): Promise<Result<R>> {
    const signal = anySignal([move.signal, stop])
    const result = await call(sent, signal)
    releaseSignal(signal)
    // Superseded: whatever came back is not this pager's state any more, and the
    // move resolves as an abort even from an endpoint that ignored its signal, so
    // no caller ever gets a success Result for a page that isn't shown.
    if (mine !== token) return aborted(result, move.signal.reason, sent)
    controller = undefined
    // Stopped by the caller's signal: their own cancellation, not a failure. Loading
    // ends; `error` and the shown page stay as they were.
    if (stop?.aborted) {
      set({ loading: false, target: null })
      return aborted(result, stop.reason, sent)
    }
    if (result.error) {
      set({ loading: false, target: null, error: result.error })
      return result
    }
    return land(result)
  }

  /** The page number of history step `i`, or null when numbers are unknown (a `from` start). */
  const pageAt = (i: number): number | null => (numberedSteps ? i + 1 : null)

  function showStep(i: number, entry: Entry<P, R>): void {
    shownAt = i
    set({
      loading: false, target: null, page: pageAt(i), params: entry.params, data: entry.result.data, error: null,
      pageCount: null, hasNext: i + 1 < history.length, hasPrev: i > 0 || history[0]!.before != null,
    })
  }

  /** Opens history step `i`: from the cache unless `fresh`, else with that step's params. */
  function step(i: number, fresh: boolean): Promise<Result<R> | null> {
    const at = history[i]!
    const hit = fresh ? undefined : at.entry
    if (hit) {
      supersede()
      showStep(i, hit)
      return Promise.resolve(hit.result)
    }
    const sent = at.params
    const mine = supersede()
    const move = new AbortController()
    controller = move
    loadingAt = i
    set({ loading: true, target: pageAt(i) })
    if (mine !== token) return Promise.resolve(own('abort', move.signal.reason, sent))
    return settle(sent, move, mine, result => {
      let after: P | null | undefined
      let before: P | null | undefined
      try {
        after = (readNext as CursorPagerOptions<P, R>['next'])(result, sent)
        // Only the earliest step of a `from` start asks: anywhere else, the step
        // before is already in history, or this is the first page.
        before = !numberedSteps && history[0] === at && readPrev ? readPrev(result, sent) : undefined
      } catch (error) {
        return failed(error, sent)
      }
      // Its index now: a Previous from a `from` start may have prepended since.
      const index = history.indexOf(at)
      const again = at.seen
      at.seen = true
      at.before = before
      // The page names its next one. When it says it is the last, the steps
      // past it are gone, with their cache entries. So are they when a page
      // shown before (a refresh, or a `cache: false` revisit) now names a
      // different next one: the list changed, and Next follows the new chain.
      // A key `stableKey` can't build counts as different. Never on a first
      // landing: a page Previous prepended names its next page in its own
      // params (Stripe's `ending_before` against `starting_after`, Relay's
      // `before` against `after`), and the page after it is already known.
      const later = history[index + 1]
      if (later && (after == null || (again && !sameParams(later.params, after)))) history.length = index + 1
      if (after != null && index + 1 === history.length) history.push({ params: after, seen: false })
      const entry: Entry<P, R> = { result, params: sent, count: null }
      if (cache) at.entry = entry
      showStep(index, entry)
      return result
    })
  }

  /** Starts cursor history over at `params`. */
  function begin(params: P, numbered: boolean): void {
    opened = { params, seen: false }
    history = [opened]
    numberedSteps = numbered
    openedNumbered = numbered
    shownAt = null
  }

  /** The step a relative cursor move counts from: the one loading, else the one shown. */
  const stepFrom = (): number | null => (state.loading ? loadingAt : shownAt)

  /** A cursor move, through the checks every move shares; `pick` names the step, or null for nowhere. */
  function cursorMove(pick: () => number | null, fresh = false): Promise<Result<R> | null> {
    const early = refused()
    if (early) return Promise.resolve(early)
    const i = pick()
    // Out of range is nowhere, never a crash.
    return i === null || !(i >= 0 && i < history.length) ? Promise.resolve(null) : step(i, fresh)
  }

  const cursorPager: Pager<P, R, T> = {
    get state() {
      return state
    },
    subscribe: listener => subscribe(listener),
    load: () => cursorMove(() => {
      if (!opened) begin(opening === undefined ? base : opening, opening === undefined)
      // A cut (a page Previous prepended now says it is the last, or names a
      // new chain) can drop the opened page: start over at its params.
      else if (!history.includes(opened)) begin(opened.params, openedNumbered)
      return history.indexOf(opened!)
    }),
    goTo: page => cursorMove(() => {
      const i = page - 1
      // Only a page already shown: the API can't jump to one not yet reached.
      return numberedSteps && Number.isInteger(page) && i >= 0 && i < history.length && history[i]!.seen ? i : null
    }),
    next: () => cursorMove(() => {
      const at = stepFrom()
      return at === null || at + 1 >= history.length ? null : at + 1
    }),
    prev: () => cursorMove(() => {
      const at = stepFrom()
      if (at === null) return null
      if (at > 0) return at - 1
      const before = history[0]!.before
      if (before == null) return null
      history.unshift({ params: before, seen: false })
      if (shownAt !== null) shownAt += 1
      return 0
    }),
    refresh: () => cursorMove(stepFrom, true),
    setParams: next => cursorMove(() => {
      base = next
      begin(next, true)
      return 0
    }, true),
  }

  /** A move to `page` (or nowhere, for `null`), through the checks every move shares. */
  function moveTo(page: number | null, fresh = false): Promise<Result<R> | null> {
    const early = refused()
    if (early) return Promise.resolve(early)
    if (page === null || (!fresh && !inRange(page))) return Promise.resolve(null)
    return visit(page, fresh)
  }

  /** The page a relative move counts from: the one loading, else the one shown. */
  const from = (): number | null => state.target ?? state.page

  function subscribe(listener: () => void): () => void {
    // A wrapper per subscription, so subscribing one function twice is two subscriptions.
    const entry = (): void => listener()
    listeners.add(entry)
    return () => {
      listeners.delete(entry)
    }
  }

  if (cursor) return cursorPager
  return {
    get state() {
      return state
    },
    subscribe: listener => subscribe(listener),
    load: () => moveTo(start),
    goTo: page => moveTo(page),
    next: () => {
      const at = from()
      return moveTo(at === null ? null : at + 1)
    },
    prev: () => {
      const at = from()
      return moveTo(at === null ? null : at - 1)
    },
    refresh: () => moveTo(from(), true),
    setParams: next => {
      const early = refused()
      if (early) return Promise.resolve(early)
      base = next
      visited.clear()
      return visit(1, true)
    },
  }
}
