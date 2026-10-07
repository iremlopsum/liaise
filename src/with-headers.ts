// =============================================================================
// with-headers.ts — a copy of a client that also sends some headers (5.3.0)
// =============================================================================
//
// A function, not a method on the client: a client is a plain object keyed by
// endpoint name, so a method would reserve the name `withHeaders` (spec §3).
// The copy is built by the client's own code — the COPY stamp each factory
// puts on its client (src/utils/copy.ts) — so this file knows nothing about
// REST or GraphQL.
// =============================================================================

import { copierOf, type WithHeadersOptions } from './utils/copy.js'
import type { EndpointExtras } from './types.js'

/** An endpoint or operation of a client: what every client method is. */
type Endpoint = ((...args: any[]) => Promise<unknown>) & EndpointExtras

/**
 * What withHeaders accepts: an object whose every property is an endpoint,
 * or, under `query` / `mutation` (a split GraphQL client), a record of them.
 * Structural rather than a brand on the client type, because a brand's key
 * would show up in `keyof typeof api` and break consumer types. A single
 * endpoint, a primitive, or an object holding anything else is a compile
 * error; an object of endpoints that isn't a real client (a spread, a
 * hand-built object) passes the types and gets the runtime stand-in.
 */
type ClientShape<T> = {
  [K in keyof T]: T[K] extends Endpoint ? T[K]
    : K extends 'query' | 'mutation' ? { [J in keyof T[K]]: Endpoint }
    : never
}

/**
 * A copy of `client` whose calls also send `headers`, as client headers: they
 * replace the client's `headers` of the same name, an endpoint's own headers
 * still win over them, and per-call headers win over everything. The original
 * is unchanged. Copies chain. Everything else — middleware, `onError`, `log`,
 * `timeout`, `fetch`, `fetchOptions` — is the client's.
 *
 * @example
 * ```ts
 * const user = withHeaders(api, { cookie: req.headers.cookie ?? '' })
 * const { data, error } = await user.me()
 * ```
 */
export function withHeaders<T extends object & ClientShape<T>>(client: T, headers: HeadersInit, options?: WithHeadersOptions): T {
  return copierOf(client)!(headers, options) as T
}
