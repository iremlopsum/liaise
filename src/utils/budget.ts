import { anySignal } from './any-signal.js'
import { timeoutSignalFor } from './timeout.js'

/**
 * One call's own deadline: how long THIS caller's pipeline may take — its
 * signal, merged with the first defined of its per-call, per-request and
 * client timeouts (non-positive at that level means none).
 *
 * Both clients build it once per `execute()`, so a retrying middleware's
 * attempts draw from one budget and `result.retry()` gets a fresh one.
 *
 * Under `share` it is still this caller's alone. A shared request has a
 * deadline of its own — the endpoint's, else the client's, measured from when
 * it was sent — which create-api.ts's share step hands to the tracker. Using
 * a caller's budget for the shared request instead is a real bug this library
 * has shipped: a shared socket once ran 1077 ms against a 100 ms configured
 * deadline.
 *
 * @param callTimeout - `CallOptions.timeout`, this caller's patience.
 * @param requestTimeout - `RequestConfig.timeout` / `OperationConfig.timeout`.
 * @param clientTimeout - `ApiConfig.timeout` / `GraphQLBaseConfig.timeout`,
 *   the client-wide fallback when neither the call nor the endpoint defines one.
 * @param callerSignal - `CallOptions.signal`.
 */
export function operationBudget(
  callTimeout: number | undefined,
  requestTimeout: number | undefined,
  clientTimeout: number | undefined,
  callerSignal: AbortSignal | undefined
): AbortSignal | undefined {
  return anySignal([callerSignal, timeoutSignalFor(callTimeout, requestTimeout, clientTimeout)])
}
