// Ported from the prototype (docs/prototypes/intro-keynote-2026-10-08/src/playground/format.ts).
// Turns console arguments and returned values into one line of text, the way a browser
// console would show them, short enough for the panel.

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`

// The reader's code runs liaise's build from the site (public/liaise), not a copy bundled here, and
// ApiError is a plain class (not an Error), so it is known by its shape.
type ApiErrorShape = { kind: unknown; status: unknown; statusText: unknown; body: unknown }
const isApiError = (v: object): v is ApiErrorShape => 'kind' in v && 'status' in v && 'statusText' in v && !(v instanceof Error)

export function inspect(value: unknown, depth = 0, seen: Set<unknown> = new Set()): string {
  if (typeof value === 'string') return quote(value)
  if (typeof value === 'bigint') return `${value}n`
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function') return `[function ${value.name || '(anonymous)'}]`
    return String(value)
  }
  if (seen.has(value)) return '[circular]'
  if (isApiError(value)) {
    const e = value
    const fields: Array<[string, unknown]> = [['kind', e.kind], ['status', e.status], ['statusText', e.statusText], ['body', e.body]]
    return `ApiError { ${fields.map(([k, v]) => `${k}: ${inspect(v, depth + 1, seen)}`).join(', ')} }`
  }
  if (value instanceof Error || (typeof DOMException !== 'undefined' && value instanceof DOMException)) {
    const e = value as Error
    return `${e.name}: ${e.message}`
  }
  if (typeof Headers !== 'undefined' && value instanceof Headers) {
    const pairs = [...value.entries()].map(([k, v]) => `${quote(k)}: ${quote(v)}`)
    return `Headers { ${pairs.join(', ')} }`
  }
  if (typeof Response !== 'undefined' && value instanceof Response) return `Response { status: ${value.status} }`
  if (value instanceof Promise) return 'Promise { <pending> }'
  if (value instanceof Date) return value.toISOString()
  if (depth > 3) return Array.isArray(value) ? '[Array]' : '{…}'
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, 20).map(v => inspect(v, depth + 1, seen))
      if (value.length > 20) items.push(`… ${value.length - 20} more`)
      return items.length ? `[ ${items.join(', ')} ]` : '[]'
    }
    const entries = Object.entries(value as Record<string, unknown>)
    const shown = entries.slice(0, 20).map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : quote(k)}: ${inspect(v, depth + 1, seen)}`)
    if (entries.length > 20) shown.push(`… ${entries.length - 20} more`)
    return shown.length ? `{ ${shown.join(', ')} }` : '{}'
  } finally {
    seen.delete(value)
  }
}

/** console.log's arguments: strings as they are, everything else inspected. */
export function formatArgs(args: unknown[]): string {
  return args.map(a => (typeof a === 'string' ? a : inspect(a))).join(' ')
}

/** A thrown value in a sentence: "TypeError: Cannot read …". */
export function describeThrown(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`
  return `${inspect(e)} (a thrown value that isn't an Error)`
}
