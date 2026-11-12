// =============================================================================
// freeze.ts — deepFreeze, for the data cacheMiddleware stores (5.5.0)
// =============================================================================

/**
 * Freezes plain data in place: every array, and every object whose prototype is
 * `Object.prototype` or `null`, reachable through such containers.
 *
 * Every hit of a cache returns the one stored `Result`, so a caller that sorted
 * `data` in place or set a field changed it for every later hit. Frozen, the edit
 * throws a `TypeError` in strict code (every ES module) instead. Freezing rather
 * than copying keeps the reference: React and store selectors don't see a new
 * object on every hit, and a 2 MB reply isn't copied on every read.
 *
 * Anything else is left as it is and not entered: a `Date`, `Map` or `Set` would
 * still change through its methods, a class instance from a schema may rely on
 * writing its own fields, and freezing a typed array with elements throws.
 * An already-frozen container is still entered, since a frozen parent may hold
 * unfrozen children. Cycles are tracked. Never throws: a throwing getter or a
 * Proxy trap ends that branch, and the rest is still frozen.
 */
export function deepFreeze(value: unknown): void {
  const seen = new Set<object>()
  const stack: unknown[] = [value]
  while (stack.length > 0) {
    const item = stack.pop()
    if (typeof item !== 'object' || item === null || seen.has(item)) continue
    seen.add(item)
    try {
      const proto = Object.getPrototypeOf(item) as unknown
      if (!Array.isArray(item) && proto !== Object.prototype && proto !== null) continue
      for (const key of Object.keys(item)) {
        try {
          stack.push((item as Record<string, unknown>)[key])
        } catch {
          // A throwing getter: skip that value.
        }
      }
      Object.freeze(item)
    } catch {
      // A Proxy whose traps throw: leave it.
    }
  }
}
