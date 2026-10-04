export function mergeHeaders(...sources: (HeadersInit | undefined)[]): Headers {
  const merged = new Headers()
  for (const source of sources) {
    if (!source) continue
    // Within one source, `new Headers()` appends a repeated name, joining the
    // values the way the platform does. Across sources, `set` lets a later
    // layer replace an earlier one (global < request < call).
    new Headers(source).forEach((value, key) => merged.set(key, value))
  }
  return merged
}

/** A plain-object copy of `headers`, lowercase names — for `getHeaders()`. */
export function headersRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => { out[key] = value })
  return out
}
