// =============================================================================
// operation-type.ts — a flat client's operation type, read from its document
// =============================================================================
//
// A split client knows each operation's type from the record it sits in
// (`queries` / `mutations`). A flat client (`operations`) has only the
// document, so createGraphQL reads it here, once per operation, at
// construction. The type decides whether retryMiddleware and cacheMiddleware
// skip the call and which default timeout it gets, so every case liaise can't
// read counts as a mutation: never retried, cached or given the query default.
//
// One forward scan, no regex lookbehind (above the supported floor): skip
// whitespace, commas, `#` comments and string literals; at the top level a
// `fragment` definition is skipped (its header to the first `{` outside
// arguments, comments and strings, then its selection set), `query` or an
// anonymous `{` is a query, `mutation` is a mutation, and anything else (a
// `subscription`, a character that can't start a definition, text that isn't
// GraphQL, the end) counts as a mutation.
// =============================================================================

import type { OperationType } from '../types.js'

const NAME = /[_A-Za-z0-9]/

export function operationTypeOf(document: string): OperationType {
  try {
    if (typeof document !== 'string') return 'mutation'
    const n = document.length
    let i = 0

    /** Index just past the string literal starting at `at` (a `"`), or -1 if it never ends. */
    const skipString = (at: number): number => {
      if (document.startsWith('"""', at)) {
        const end = document.indexOf('"""', at + 3)
        return end === -1 ? -1 : end + 3
      }
      for (let j = at + 1; j < n; j++) {
        const c = document[j]
        if (c === '\\') j++
        else if (c === '"') return j + 1
        else if (c === '\n') return -1
      }
      return -1
    }

    /** Index just past the `#` comment starting at `at`. */
    const skipComment = (at: number): number => {
      const end = document.indexOf('\n', at)
      return end === -1 ? n : end + 1
    }

    // The top level: only names, whitespace, commas, comments, strings and an
    // anonymous `{` can start a definition. Anything else is unreadable.
    while (i < n) {
      const c = document[i]
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',' || c === '\uFEFF') { i++; continue }
      if (c === '#') { i = skipComment(i); continue }
      if (c === '"') {
        const end = skipString(i)
        if (end === -1) return 'mutation'
        i = end
        continue
      }
      if (c === '{') return 'query'
      if (!NAME.test(c)) return 'mutation'
      let j = i
      while (j < n && NAME.test(document[j])) j++
      const word = document.slice(i, j)
      if (word === 'query') return 'query'
      if (word === 'mutation') return 'mutation'
      if (word !== 'fragment') return 'mutation'
      // A fragment definition. Its header (name, type condition, directives)
      // may hold `{` inside arguments (`@arguments(x: {a: 1})`), comments or
      // strings, so the selection set starts at the first `{` outside all of
      // those. The set itself is then skipped to its closing brace.
      i = j
      let nesting = 0
      while (i < n) {
        const d = document[i]
        if (d === '#') { i = skipComment(i); continue }
        if (d === '"') {
          const end = skipString(i)
          if (end === -1) return 'mutation'
          i = end
          continue
        }
        if (d === '(' || d === '[') nesting++
        else if (d === ')' || d === ']') nesting--
        else if (d === '{' && nesting === 0) break
        else if (d === '{') nesting++
        else if (d === '}') nesting--
        if (nesting < 0) return 'mutation'
        i++
      }
      if (i >= n) return 'mutation'
      let depth = 1
      i++
      while (i < n && depth > 0) {
        const d = document[i]
        if (d === '"') {
          const end = skipString(i)
          if (end === -1) return 'mutation'
          i = end
          continue
        }
        if (d === '#') { i = skipComment(i); continue }
        if (d === '{') depth++
        else if (d === '}') depth--
        i++
      }
      if (depth > 0) return 'mutation'
    }
    return 'mutation'
  } catch {
    return 'mutation'
  }
}
