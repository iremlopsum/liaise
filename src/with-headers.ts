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

import { ApiError, createNetworkErrorResult } from './result.js'
import type { EndpointExtras, Result } from './types.js'
import { copierOf, nextCopy, type WithHeadersOptions } from './utils/copy.js'

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

const NOT_A_CLIENT =
  "withHeaders was given something that isn't a client from createApi or createGraphQL. " +
  'A spread or hand-built object loses what withHeaders needs: pass the client itself.'

/**
 * What `withHeaders` returns for anything that isn't a client. It never
 * throws (spec §5: it runs inside request handlers, where a throw breaks the
 * page), so the mistake surfaces on the first call instead: every call, at any
 * property depth, resolves to a 'network' Result naming it. `then` and symbol
 * keys are undefined, so the stand-in is not a promise — `await` on it would
 * otherwise hang.
 */
function standIn(): unknown {
  const call = (): Promise<Result<never>> => Promise.resolve(createNetworkErrorResult(new ApiError({
    status: 0,
    kind: 'network',
    statusText: '',
    body: new TypeError(NOT_A_CLIENT),
    headers: new Headers(),
    request: { method: '', url: '', params: {} },
  }), call))
  return new Proxy(call, { get: (_, key) => (key === 'then' || typeof key === 'symbol' ? undefined : standIn()) })
}

/**
 * A copy of `client` whose calls also send `headers`, as client headers: they
 * replace the client's `headers` of the same name, an endpoint's own headers
 * still win over them, and per-call headers win over everything. The original
 * is unchanged. Copies chain. Everything else — middleware, `onError`, `log`,
 * `timeout`, `fetch`, `fetchOptions` — is the client's.
 *
 * Never throws: an invalid header value fails each call as a 'network' Result,
 * and something that isn't a client returns a stand-in whose calls do the same.
 *
 * @example
 * ```ts
 * const user = withHeaders(api, { cookie: req.headers.cookie ?? '' })
 * const { data, error } = await user.me()
 * ```
 */
export function withHeaders<T extends object & ClientShape<T>>(client: T, headers: HeadersInit, options?: WithHeadersOptions): T {
  const copier = copierOf(client)
  return (copier ? copier(parent => nextCopy(parent, headers, options)) : standIn()) as T
}
