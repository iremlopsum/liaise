/**
 * A thrown callback, or an endpoint that fails to return a Result, never breaks
 * poll or a pager. In a browser (where there is a `document`) it goes to
 * `reportError`, like an error thrown from an event handler. Everywhere else it's
 * logged, saying what failed: Deno's `reportError` ends the process, and Node has
 * none. Never re-thrown later: in Node an async throw would crash the process.
 *
 * @param what - Who failed, prefixed with the caller: `'poll: the callback'`
 *   prints `[liaise] poll: the callback failed:`.
 */
export function report(error: unknown, what: string): void {
  const g = globalThis as { reportError?: (error: unknown) => void }
  if (typeof document !== 'undefined' && typeof g.reportError === 'function') g.reportError(error)
  else console.error(`[liaise] ${what} failed:`, error)
}
