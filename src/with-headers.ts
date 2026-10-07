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

import { copierOf, type LiaiseClient, type WithHeadersOptions } from './utils/copy.js'

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
export function withHeaders<T extends LiaiseClient>(client: T, headers: HeadersInit, options?: WithHeadersOptions): T {
  return copierOf(client)!(headers, options) as T
}
