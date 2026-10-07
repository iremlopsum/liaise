// =============================================================================
// copy.ts — what a client needs to be copied by withHeaders (5.3.0)
// =============================================================================
//
// A copy is a real client, built by the same code as the original from a
// different CopyState (create-api.ts `build`, graphql.ts `buildSide`). This
// file holds that state and the two hidden stamps that connect the pieces:
//
// - COPY, on a client: the function withHeaders calls to copy it.
// - POLL_ID, on each endpoint of a copy: the original client's endpoint and
//   what the copy adds, so poll.ts shares one loop between copies that send
//   the same thing, however often they are rebuilt.
//
// Both are Symbol.for keys defined non-enumerable, like CLIENT_FETCH: spreads,
// Object.keys, JSON and logs never see them, and two bundled copies of liaise
// still agree on them. Not public API, except the two types index.ts names.
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
  /** Header sources, merged at call time: the client's `headers`, then each copy's, oldest first. */
  readonly headers: readonly (HeadersInit | undefined)[]
  /** What dedupe keys this client's calls by, after the endpoint's own lane: '' on the original. */
  readonly lane: string
  /** false: no call through this client dedupes. */
  readonly dedupe: boolean
}

/** What a client's COPY stamp holds: makes a copy of that client. */
export type Copier = (headers: HeadersInit, options?: WithHeadersOptions) => object

/** The original client's state: its own `headers`, no lane, dedupe as each endpoint says. */
export const originalState = (headers: HeadersInit | undefined): CopyState => ({ headers: [headers], lane: '', dedupe: true })

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
 * Never throws: added headers `Headers` refuses get a lane no other copy has.
 * Their calls fail anyway, as a 'network' Result, when the merge runs at call
 * time — which is why the sources are kept as a list and not merged here.
 */
export function nextCopy(parent: CopyState, headers: HeadersInit, options: WithHeadersOptions | undefined): CopyState {
  const all = [...parent.headers, headers]
  let lane = ''
  try {
    const pairs: string[][] = []
    mergeHeaders(...all.slice(1)).forEach((value, name) => { pairs.push([name, value]) })
    if (pairs.length) lane = `\u0000${JSON.stringify(pairs)}`
  } catch {
    lane = `\u0000!${++invalid}`
  }
  return { headers: all, lane, dedupe: options?.dedupe ?? parent.dedupe }
}

/** A copy's poll key: its lane, marked when dedupe is off (its calls behave differently). */
export const pollKeyOf = (copy: CopyState): string => (copy.dedupe ? copy.lane : `${copy.lane}\u0000-`)

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

export function pollIdOf(endpoint: object): PollId | undefined {
  return (endpoint as Record<symbol, PollId | undefined>)[POLL_ID]
}
