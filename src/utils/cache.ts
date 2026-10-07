// =============================================================================
// cache.ts — In-memory cache store for cacheMiddleware, and its fetch-options key
// =============================================================================

/** The id each identity-keyed object got, for as long as the object lives. */
const identities = new WeakMap<object, number>()
let lastIdentity = 0

/**
 * The fetch-options part of `cacheMiddleware`'s key. Pass it the copy that
 * goes to fetch (`sendableFetchOptions`), so the fields liaise controls are
 * not in it.
 *
 * Separate from `stableKey`, which keys params, because options reach fetch
 * **by reference**: an undici `Agent` in `dispatcher` is the agent, client
 * certificate and all, not its enumerable fields. Keyed by content, two Agents
 * with different certificates keyed alike and one tenant was served another's
 * response (the 5.2.0 final review). So:
 *
 * - string, boolean, `null` and a finite number → by value; an `undefined`
 *   member is dropped (fetch reads it as absent). In an array it keys as the
 *   token `undefined`.
 * - an array, and an object whose prototype is `Object.prototype` or `null`
 *   → by content, recursively, object keys sorted.
 * - any other object, and a function (a class instance such as an `Agent`, a
 *   `Map`, a `Date`) → by identity: the token `#n`, where `n` is the object's
 *   id in a `WeakMap`. The same object keeps its id, so reusing one agent
 *   keeps hitting the cache, and two agents never share an entry however
 *   alike they look. The token is unquoted, so it cannot equal a string,
 *   which is always JSON-quoted.
 *
 * Returns `null` — don't cache, don't serve — for a circular structure, a
 * BigInt, a symbol or a non-finite number. Never throws: a throwing getter
 * declines too.
 */
export function cacheOptionsKey(options: unknown): string | null {
  try {
    const key = optionKey(options, new Set())
    return key === undefined ? 'undefined' : key
  } catch {
    return null
  }
}

/** `string` is a key, `null` is decline, `undefined` is "omit this member". */
function optionKey(value: unknown, seen: Set<object>): string | null | undefined {
  switch (typeof value) {
    case 'undefined':
      return undefined
    case 'string':
    case 'boolean':
      return JSON.stringify(value)
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : null
    case 'function':
      return identity(value as object)
    case 'object':
      break
    default:
      return null // bigint, symbol
  }
  if (value === null) return 'null'
  const obj = value as object
  const proto = Object.getPrototypeOf(obj) as unknown
  const isArray = Array.isArray(obj) && proto === Array.prototype
  if (!isArray && proto !== Object.prototype && proto !== null) return identity(obj)
  if (seen.has(obj)) return null // an ancestor on the current path: circular
  seen.add(obj)
  try {
    if (isArray) {
      const parts: string[] = []
      for (const item of obj as unknown[]) {
        const s = optionKey(item, seen)
        if (s === null) return null
        parts.push(s === undefined ? 'undefined' : s)
      }
      return `[${parts.join(',')}]`
    }
    const pairs: string[] = []
    for (const k of Object.keys(obj).sort()) {
      const s = optionKey((obj as Record<string, unknown>)[k], seen)
      if (s === null) return null
      if (s !== undefined) pairs.push(`${JSON.stringify(k)}:${s}`)
    }
    return `{${pairs.join(',')}}`
  } finally {
    seen.delete(obj)
  }
}

function identity(obj: object): string {
  let id = identities.get(obj)
  if (id === undefined) {
    id = ++lastIdentity
    identities.set(obj, id)
  }
  return `#${id}`
}

interface CacheEntry {
  value: unknown
  timestamp: number
}

/**
 * In-memory cache store for `cacheMiddleware`. Stores values by string key
 * with TTL-based expiry and oldest-first eviction when the store is full.
 *
 * Each entry is stamped with an insertion timestamp. On `get()`, if the
 * entry is older than `ttl` milliseconds, it is deleted and `null` is
 * returned. On `set()`, if the store has reached `maxSize`, the entry with
 * the lowest insertion timestamp is evicted before the new one is added.
 *
 * This is NOT a true LRU cache — eviction is by insertion time, not by
 * last access time. For the small cache sizes this class is designed for
 * (default: 50 entries), the distinction is rarely meaningful in practice.
 *
 * @example
 * ```ts
 * const store = new CacheStore({ ttl: 60_000, maxSize: 50 })
 * store.set('getUser|{"id":"1"}', responseResult)
 * store.get('getUser|{"id":"1"}') // → responseResult (within TTL)
 * store.clear()
 * store.get('getUser|{"id":"1"}') // → null
 * ```
 */
export class CacheStore {
  private cache = new Map<string, CacheEntry>()
  private readonly ttl: number
  private readonly maxSize: number

  constructor(options: { ttl: number; maxSize: number }) {
    this.ttl = options.ttl
    this.maxSize = options.maxSize
  }

  /**
   * Retrieves a cached value if it exists and hasn't expired.
   *
   * Returns `null` if the key is not found or if the entry's age reaches or exceeds
   * the configured TTL. Expired entries are deleted from the store on access
   * rather than on a background timer.
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() - entry.timestamp >= this.ttl) {
      this.cache.delete(key)
      return null
    }
    return entry.value as T
  }

  /**
   * Stores a value under the given key with the current timestamp.
   *
   * If the store has reached `maxSize`, the entry with the oldest insertion
   * timestamp is evicted before the new entry is added. Eviction is O(n) —
   * acceptable because `maxSize` is designed to be small (≤ 200).
   */
  set(key: string, value: unknown): void {
    if (this.maxSize === 0) return
    if (this.cache.size >= this.maxSize) {
      let oldestKey: string | null = null
      let oldestTimestamp = Infinity
      for (const [k, entry] of this.cache) {
        if (entry.timestamp < oldestTimestamp) {
          oldestTimestamp = entry.timestamp
          oldestKey = k
        }
      }
      if (oldestKey !== null) this.cache.delete(oldestKey)
    }
    this.cache.set(key, { value, timestamp: Date.now() })
  }

  /**
   * Removes all entries from the store immediately.
   *
   * Useful for invalidating the entire cache — for example, on user logout
   * to prevent the next user from seeing stale data.
   */
  clear(): void {
    this.cache.clear()
  }
}
