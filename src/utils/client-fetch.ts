/**
 * The client's own `fetch`, stamped on the middleware context so cacheMiddleware can key
 * on which fetch sends the call (5.2.0). Not public API: non-enumerable, so spreads, logs
 * and JSON never see it. Symbol.for, so the core and liaise/middleware agree even when a
 * bundler duplicates the module.
 */
export const CLIENT_FETCH = Symbol.for('liaise.clientFetch')

/** Stamp the client's own `fetch` on a context. Nothing is stamped for the global fetch. */
export function stampClientFetch(context: object, clientFetch: unknown): void {
  if (clientFetch !== undefined) Object.defineProperty(context, CLIENT_FETCH, { value: clientFetch })
}

/** The client's own `fetch` stamped on a context, or `undefined` for a client on the global fetch. */
export function clientFetchOf(context: object): unknown {
  return (context as Record<symbol, unknown>)[CLIENT_FETCH]
}
