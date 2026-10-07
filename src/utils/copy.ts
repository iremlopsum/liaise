// =============================================================================
// copy.ts — what a client needs to be copied by withHeaders (5.3.0)
// =============================================================================
//
// A copy is a real client, built by the same code as the original from a
// different CopyState (create-api.ts `build`, graphql.ts `buildSide`). This
// file holds that state and the two hidden stamps that connect the pieces:
//
// - COPY, on a client: the function withHeaders calls to copy it. It takes a
//   `derive` function (the parent's state → the copy's), so `nextCopy` is
//   imported by with-headers.ts alone and a bundle that never imports
//   withHeaders doesn't carry it.
// - POLL_ID, on each endpoint of a copy: the original client's endpoint and
//   what the copy adds, so poll.ts shares one loop between copies that send
//   the same thing, however often they are rebuilt.
//
// Both are Symbol.for keys defined non-enumerable, like CLIENT_FETCH: spreads,
// Object.keys, JSON and logs never see them, and two bundled copies of liaise
// still agree on them. Not public API, except WithHeadersOptions, which
// index.ts names.
//
// CopyState is ADD-ONLY: never rename or remove a field. Because COPY is a
// Symbol.for stamp, a bundle holding two copies of liaise can have an older
// withHeaders derive a newer client's state; nextCopy spreads the parent, so a
// new field survives that, but a renamed or removed one would leave the client
// building from a state that lacks it.
// =============================================================================

import { mergeHeaders } from './headers.js'

export const COPY = Symbol.for('liaise.copy')
export const POLL_ID = Symbol.for('liaise.pollId')

/** The options of `withHeaders`. */
export interface WithHeadersOptions {
  /**
   * `false` turns `dedupe` off for every call through the copy: on an endpoint
   * with `dedupe: true`, a call neither cancels another nor can be cancelled.
   * Copies of this copy inherit it unless they set it.
   */
  dedupe?: boolean
}

/** The settings a client — the original or a copy — builds its endpoints from. */
export interface CopyState {
  /**
   * Header sources, merged at call time: the client's `headers`, then (on a
   * copy) every copy layer's headers, snapshotted when the copy was made.
   */
  readonly headers: readonly (HeadersInit | undefined)[]
  /** What dedupe keys this client's calls by, after the endpoint's own lane: '' on the original. */
  readonly lane: string
  /** false: no call through this client dedupes. */
  readonly dedupe: boolean
  /** What poll.ts keys this client's loops by (POLL_ID): the lane, marked when dedupe is off. '' on the original. */
  readonly pollKey: string
}

/** What a client's COPY stamp holds: builds a copy of that client from `derive(its own state)`. */
export type Copier = (derive: (parent: CopyState) => CopyState) => object

/** The original client's state: its own `headers`, no lane, dedupe as each endpoint says. */
export const originalState = (headers: HeadersInit | undefined): CopyState => ({ headers: [headers], lane: '', dedupe: true, pollKey: '' })

let invalid = 0

/**
 * The state of a copy of `parent` that adds `headers`.
 *
 * The lane comes from the ADDED headers alone — every copy layer since the
 * original, merged — so copies that add the same headers share one, however
 * often they are rebuilt (a copy made inside a React component is rebuilt on
 * every render). `Headers` iterates names lowercased and sorted (Fetch's "sort
 * and combine"), so `{ Cookie }` and `[['cookie', …]]` give one lane without a
 * sort here. It starts with NUL: a dedupe key is the endpoint's own lane
 * (`name`, or `query:name` in a split GraphQL client) plus this, and no
 * endpoint name contains NUL.
 *
 * The added headers are merged here, once, and the copy keeps that snapshot
 * (as `[name, value]` pairs, the same ones the lane is made of): a copy's keys
 * must describe what it sends, so mutating the caller's object or `Headers`
 * afterwards, or a getter returning something else on the next read, changes
 * nothing. The client's own `headers` stay the first source, as on the original.
 *
 * Never throws: added headers `Headers` refuses get a lane no other copy has,
 * and the raw layers are kept instead of a snapshot, so every call fails as a
 * 'network' Result when the merge runs again at call time.
 *
 * The poll key is the lane, marked when dedupe is off: such a copy's calls
 * behave differently, so it polls on a loop of its own.
 */
export function nextCopy(parent: CopyState, headers: HeadersInit, options: WithHeadersOptions | undefined): CopyState {
  let sources: (HeadersInit | undefined)[] = [...parent.headers, headers]
  let lane = ''
  try {
    const pairs: [string, string][] = []
    mergeHeaders(...sources.slice(1)).forEach((value, name) => { pairs.push([name, value]) })
    if (pairs.length) lane = `\u0000${JSON.stringify(pairs)}`
    sources = [parent.headers[0], pairs]
  } catch {
    lane = `\u0000!${++invalid}`
  }
  const dedupe = options?.dedupe ?? parent.dedupe
  return { ...parent, headers: sources, lane, dedupe, pollKey: dedupe ? lane : `${lane}\u0000-` }
}

export function stampCopier(client: object, copier: Copier): void {
  Object.defineProperty(client, COPY, { value: copier })
}

export function copierOf(value: unknown): Copier | undefined {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  const copier = (value as Record<symbol, unknown>)[COPY]
  return typeof copier === 'function' ? (copier as Copier) : undefined
}

/** A copied endpoint's poll identity: the original client's endpoint, and the copy's poll key. */
export interface PollId {
  readonly origin: object
  readonly key: string
}

export function stampPollId(endpoint: object, origin: object, key: string): void {
  Object.defineProperty(endpoint, POLL_ID, { value: { origin, key } })
}

/** Never throws: an endpoint whose read throws (a revoked Proxy) has no poll identity, so it keys on itself, as before 5.3.0. */
export function pollIdOf(endpoint: object): PollId | undefined {
  try {
    return (endpoint as Record<symbol, PollId | undefined>)[POLL_ID]
  } catch {
    return undefined
  }
}
