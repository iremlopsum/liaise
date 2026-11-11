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
// whitespace, commas, `#` comments and string literals; at brace depth 0 a
// `fragment` definition is skipped to its closing brace, `query` or an
// anonymous `{` is a query, `mutation` is a mutation, anything else (a
// `subscription`, text that isn't GraphQL, the end) counts as a mutation.
// =============================================================================

import type { OperationType } from '../types.js'

const NAME = /[_A-Za-z0-9]/

export function operationTypeOf(document: string): OperationType {
  try {
    if (typeof document !== 'string') return 'mutation'
    const n = document.length
    let i = 0
    let depth = 0

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

    while (i < n) {
      const c = document[i]
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',' || c === '﻿') { i++; continue }
      if (c === '#') {
        const end = document.indexOf('\n', i)
        i = end === -1 ? n : end + 1
        continue
      }
      if (c === '"') {
        const end = skipString(i)
        if (end === -1) return 'mutation'
        i = end
        continue
      }
      if (c === '{') {
        if (depth === 0) return 'query'
        depth++; i++; continue
      }
      if (c === '}') { depth--; i++; continue }
      if (depth === 0 && NAME.test(c)) {
        let j = i
        while (j < n && NAME.test(document[j])) j++
        const word = document.slice(i, j)
        if (word === 'query') return 'query'
        if (word === 'mutation') return 'mutation'
        if (word !== 'fragment') return 'mutation'
        // A fragment definition: skip its header to the selection set, then
        // the set itself, so its `{` isn't read as an anonymous query.
        i = j
        while (i < n && document[i] !== '{') {
          if (document[i] === '"') {
            const end = skipString(i)
            if (end === -1) return 'mutation'
            i = end
          } else i++
        }
        if (i >= n) return 'mutation'
        depth = 1
        i++
        while (i < n && depth > 0) {
          const d = document[i]
          if (d === '"') {
            const end = skipString(i)
            if (end === -1) return 'mutation'
            i = end
            continue
          }
          if (d === '#') {
            const end = document.indexOf('\n', i)
            i = end === -1 ? n : end + 1
            continue
          }
          if (d === '{') depth++
          else if (d === '}') depth--
          i++
        }
        if (depth > 0) return 'mutation'
        continue
      }
      i++
    }
    return 'mutation'
  } catch {
    return 'mutation'
  }
}
