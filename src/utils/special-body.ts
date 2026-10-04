/**
 * True for a WHATWG `ReadableStream`. Guarded with `typeof` because a runtime
 * without streams has no global to `instanceof` against.
 */
export function isReadableStream(value: unknown): value is ReadableStream {
  return typeof ReadableStream !== 'undefined' && value instanceof ReadableStream
}

/**
 * True when `value` is a body type that cannot be decomposed into key-value
 * pairs — `FormData`, `Blob`, `ArrayBuffer`, any `ArrayBufferView` (typed
 * arrays, `DataView`, Node's `Buffer`), a `ReadableStream`, `URLSearchParams`,
 * or a raw string.
 *
 * Used by `create-api.ts`'s URL-building step, which skips path/query
 * decomposition for these entirely and hands them straight to
 * `serializeBody`. A raw string belongs here: it is a body-serialisation
 * concern, and a string can't be decomposed into path/query params either.
 *
 * Do not use this to decide whether params can be *keyed* for
 * `cacheMiddleware` — that is a different question, answered by `stableKey`
 * in `./stable-key.js`, which keys by content at every depth and returns
 * `null` for what it cannot key. `cacheMiddleware` and `share` used to share
 * this predicate, but excluding `string` disabled caching and sharing for
 * every string-param endpoint even though a string keys soundly (fixed in
 * 2.2.1). `share` no longer keys params at all; it compares the request as
 * sent (`requestKey` in `./share.js`).
 */
export function isSpecialBody(value: unknown): boolean {
  return (
    value instanceof FormData ||
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    isReadableStream(value) ||
    value instanceof URLSearchParams ||
    typeof value === 'string'
  )
}
