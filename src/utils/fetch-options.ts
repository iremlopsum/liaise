// =============================================================================
// fetch-options.ts — the `fetchOptions` passed through to fetch (5.2.0).
// =============================================================================
// Both clients merge the three levels with `mergeFetchOptions` in setup,
// before middleware runs (ctx.request.fetchOptions), and build what fetch
// receives with `sendableFetchOptions` in core, after it, so a middleware's
// change takes effect and liaise's own fields always win.
// =============================================================================

import type { FetchOptions } from '../types.js'

/** The init fields liaise sets itself. What goes to fetch never takes them from the options. */
const OWNED: ReadonlySet<string> = new Set(['method', 'headers', 'body', 'signal', 'duplex'])

/**
 * Client, then endpoint, then call: a later level's field replaces an earlier
 * one's, and a field whose value is `undefined` replaces nothing. Always a
 * fresh object, so a middleware changing it can't reach the configuration or
 * the next call. The copy is shallow: a nested object, such as Next.js's
 * `next`, is shared with the configuration. A level that isn't an object is
 * skipped.
 */
export function mergeFetchOptions(...levels: unknown[]): FetchOptions {
  const merged: Record<string, unknown> = {}
  for (const level of levels) {
    if (typeof level !== 'object' || level === null) continue
    for (const key of Object.keys(level)) {
      const value = (level as Record<string, unknown>)[key]
      if (value !== undefined) merged[key] = value
    }
  }
  return merged as FetchOptions
}

/**
 * The options as they go to fetch: a copy without the fields liaise controls.
 * Anything that isn't an object (a middleware assigned `null`) is no options.
 * Only reads, so a frozen object is fine.
 */
export function sendableFetchOptions(options: unknown): Record<string, unknown> {
  const sendable: Record<string, unknown> = {}
  if (typeof options !== 'object' || options === null) return sendable
  for (const key of Object.keys(options)) {
    if (!OWNED.has(key)) sendable[key] = (options as Record<string, unknown>)[key]
  }
  return sendable
}
