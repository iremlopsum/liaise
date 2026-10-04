// =============================================================================
// timeout.ts — shared timeout-signal resolution
// =============================================================================
//
// Both createApi and createGraphQL resolve a whole-operation deadline the
// same way: a per-call timeout beats a per-request (or per-operation) one,
// which beats the client's, and anything non-positive means "no timeout".
// This one function is the single source of truth for that precedence — see
// RequestConfig.timeout, CallOptions.timeout and ApiConfig.timeout for the
// user-facing contract.
// =============================================================================

/**
 * `AbortSignal.timeout(ms)` where it exists; otherwise the same thing built
 * from an AbortController and setTimeout. React Native's Hermes (and older
 * Safari) lack the static method. Nothing global is patched: this package is
 * `sideEffects: false`, and changing a platform API inside someone else's app
 * is not a library's call.
 *
 * The fallback's reason is a plain Error named 'TimeoutError', not a
 * DOMException, because Hermes has no DOMException; abortKind classifies by
 * name, so it is still kind 'timeout'. Its timer is not cleared early: it
 * fires at the deadline and aborts a signal nobody listens to any more.
 * Clearing it would mean releasing a merged signal's inputs, which can belong
 * to another live call (spec 5.0.1, D4 amendment).
 */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms)
  const controller = new AbortController()
  const reason = new Error('The operation timed out.')
  reason.name = 'TimeoutError'
  setTimeout(() => controller.abort(reason), ms)
  return controller.signal
}

/**
 * Resolves the effective timeout into an `AbortSignal.timeout()` signal, or
 * `undefined` when no timeout applies.
 *
 * Precedence: per-call, then per-request/per-operation, then client — the
 * first DEFINED level wins. Non-positive at that level means none and stops
 * the fallback (so an endpoint's `timeout: 0` opts out of the client's
 * default); all omitted also means none.
 *
 * `AbortSignal.timeout()` accepts only an integer in `[0, 2^31 - 1]` and
 * throws a `RangeError` for anything else, so the value is normalised before
 * it gets there. Ordinary arithmetic produces out-of-contract values all the
 * time — `budget / 3`, `seconds * 1000 * 1.5`, `Number(process.env.TIMEOUT)` —
 * and without this the throw would surface as a `kind: 'network'` Result with
 * a `RangeError` body *and no request ever sent*, indistinguishable from being
 * offline. A fractional deadline is rounded down to the nearest millisecond,
 * but never down to zero: any resolved value greater than zero is clamped up
 * to a 1 ms minimum, so `timeout: 0.5` still produces a real (if generous)
 * deadline instead of silently meaning "no timeout" — the opposite of the
 * caller's intent. A value beyond the 32-bit timer ceiling is clamped to it
 * rather than wrapping round to ~1 ms (the `TimeoutOverflowWarning`
 * behaviour); `NaN` and anything non-positive (including omitted) fall out
 * through the `raw > 0` test as "no timeout", same as before.
 *
 * @param callTimeout - `CallOptions.timeout` for this specific call.
 * @param requestTimeout - `RequestConfig.timeout` / `OperationConfig.timeout`
 *   for the endpoint or operation.
 * @param clientTimeout - `ApiConfig.timeout` / `GraphQLBaseConfig.timeout`,
 *   the client-wide default. Optional so two-argument callers keep compiling.
 */
export function timeoutSignalFor(
  callTimeout: number | undefined,
  requestTimeout: number | undefined,
  clientTimeout?: number
): AbortSignal | undefined {
  // Math.min first so Infinity becomes the ceiling rather than surviving into
  // a later Math.floor. The `raw > 0` test happens BEFORE flooring: flooring
  // first would turn any 0 < raw < 1 deadline into 0, which then fails this
  // very test and disables the timeout entirely — the bug this guards
  // against. NaN also falls out here, since `NaN > 0` is false.
  const raw = Math.min(callTimeout ?? requestTimeout ?? clientTimeout ?? 0, 2 ** 31 - 1)
  if (!(raw > 0)) return undefined
  // A genuine positive deadline always yields at least 1ms, even when it
  // floors to 0 (e.g. `timeout: 0.5`) — flooring to nothing would silently
  // mean "no timeout", the opposite of what a positive value asked for.
  const ms = Math.max(1, Math.floor(raw))
  return timeoutSignal(ms)
}
