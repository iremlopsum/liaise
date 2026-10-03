/**
 * Cleanup for every merged signal anySignal created, keyed by that signal.
 *
 * anySignal only unregisters its listeners when something aborts. A call that
 * completes normally used to leave one listener on the caller's signal per
 * call, forever: 25 calls on a component-scoped controller left 25. Callers
 * release a merged signal once its call has a Result (see releaseSignal).
 * A WeakMap, so an unreleased signal still does not keep anything alive.
 */
const disposers = new WeakMap<AbortSignal, () => void>()

/**
 * Remove the listeners `anySignal` registered for `signal`. Call it once the
 * call that owns the signal has settled. A no-op for a signal anySignal did
 * not create (a caller's own signal, the single-signal fast path, undefined),
 * and idempotent. It deliberately does NOT release the merge's inputs: an
 * input may be a signal another, still-running call owns, for example when a
 * middleware passes ctx.request.signal into a nested api call.
 */
export function releaseSignal(signal: AbortSignal | undefined): void {
  if (!signal) return
  const dispose = disposers.get(signal)
  if (!dispose) return
  disposers.delete(signal)
  dispose()
}

/**
 * Composes several abort signals into one that aborts when the first of them
 * aborts, carrying that signal's `reason` through.
 *
 * Deliberately not `AbortSignal.any`, which requires Node 20.3+ (this package
 * declares `node >= 20`) and Chrome 116 / Safari 17.4 / Firefox 124. This
 * library targets any runtime with `fetch`, so a platform API with a floor
 * that high is not usable here.
 *
 * Preserving `reason` is load-bearing: it is what keeps a `TimeoutError`
 * distinguishable from a plain `AbortError` after merging, which the error
 * model depends on to tell a timeout from a cancellation.
 *
 * @param signals - Signals to merge; `undefined` entries are ignored.
 * @returns `undefined` if no signal was given, the sole signal if exactly one
 *   was (no controller allocated), otherwise a merged signal.
 */
export function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const defined = signals.filter((s): s is AbortSignal => s !== undefined)

  // Fast paths: allocate nothing for the common cases.
  if (defined.length === 0) return undefined
  if (defined.length === 1) return defined[0]

  const controller = new AbortController()
  const registered: Array<{ signal: AbortSignal; listener: () => void }> = []

  // Once the race is decided the remaining listeners are dead weight, and each
  // one keeps this controller reachable for as long as its input signal lives.
  // A caller's signal often outlives the request by a lot — a component-scoped
  // controller reused across many calls — so dropping them promptly is what
  // stops one dead listener accumulating per request.
  const cleanup = (): void => {
    for (const entry of registered) entry.signal.removeEventListener('abort', entry.listener)
    registered.length = 0
  }

  const abortWith = (reason: unknown): void => {
    if (!controller.signal.aborted) controller.abort(reason)
    cleanup()
  }

  for (const signal of defined) {
    if (signal.aborted) {
      abortWith(signal.reason)
      break
    }
    const listener = (): void => abortWith(signal.reason)
    registered.push({ signal, listener })
    signal.addEventListener('abort', listener, { once: true })
  }

  disposers.set(controller.signal, cleanup)
  return controller.signal
}
