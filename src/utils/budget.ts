import { anySignal } from './any-signal.js'
import { timeoutSignalFor } from './timeout.js'

/**
 * One call's own deadline: how long THIS caller's pipeline may take — its
 * signal, merged with the first defined of its per-call, per-request and
 * client timeouts (non-positive at that level means none) — plus, as
 * `endpointDeadline`, the deadline inside it when that deadline is the
 * endpoint's or the client's rather than the call's own.
 *
 * Both clients build it once per `execute()`, so a retrying middleware's
 * attempts draw from one budget and `result.retry()` gets a fresh one.
 *
 * Under `share` the signal is still this caller's alone. A shared request has
 * a deadline of its own — the endpoint's, else the client's, measured from
 * when it was sent — which each client's share step hands to the tracker.
 * Using a caller's budget for the shared request instead is a real bug this
 * library has shipped: a shared socket once ran 1077 ms against a 100 ms
 * configured deadline.
 *
 * `endpointDeadline` is the same deadline a shared request carries, so a
 * caller that gives up to it while waiting on a shared request has not failed
 * on its own account: under a hung server every caller's copy of it fires at
 * about the same moment as the shared request's, and they are all one
 * failure. The share step recognises it by its abort reason — `anySignal`
 * hands that reason through unchanged, so `signal.reason ===
 * endpointDeadline.reason` holds exactly when this deadline is what aborted
 * the call (`narrowTag`, utils/share.ts). A per-call timeout is the caller's
 * own patience, so with one set this is `undefined`.
 *
 * @param callTimeout - `CallOptions.timeout`, this caller's patience.
 * @param requestTimeout - `RequestConfig.timeout` / `OperationConfig.timeout`.
 * @param clientTimeout - `ApiConfig.timeout` / `GraphQLBaseConfig.timeout`,
 *   the client-wide fallback when neither the call nor the endpoint defines one.
 * @param callerSignal - `CallOptions.signal`.
 */
export function callBudget(
  callTimeout: number | undefined,
  requestTimeout: number | undefined,
  clientTimeout: number | undefined,
  callerSignal: AbortSignal | undefined
): { signal: AbortSignal | undefined; endpointDeadline: AbortSignal | undefined } {
  const deadline = timeoutSignalFor(callTimeout, requestTimeout, clientTimeout)
  return {
    signal: anySignal([callerSignal, deadline]),
    // `== null`, as timeoutSignalFor's `??` reads it: an untyped
    // `timeout: null` is no per-call timeout either.
    endpointDeadline: callTimeout == null ? deadline : undefined,
  }
}
