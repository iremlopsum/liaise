/**
 * Parses a `Retry-After` header value in either wire format defined by the
 * HTTP spec — delta-seconds (`"120"`) or an HTTP-date (`"Wed, 21 Oct ...
 * GMT"`). Returns the delay in milliseconds, or `null` if the value is
 * missing, blank, or unparseable in both formats (so the caller can fall
 * back to the computed backoff instead of retrying with `NaN`, throwing, or
 * — for a whitespace-only value, which `Number()` coerces to `0` — silently
 * retrying immediately).
 */
export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const when = Date.parse(trimmed)
  if (Number.isNaN(when)) return null
  return Math.max(0, when - Date.now())
}
