// =============================================================================
// classify-params.ts — decide what a call's params ARE before building a URL
// =============================================================================
//
// `buildUrl` decomposes params with Object.entries, and the body is serialised
// only when something is left over. Before 5.0.1 that meant any value whose
// content is not in own enumerable keys (a Map, a Set, a Date, a class with
// getters or only toJSON, a stream on a GET) left with no body and no error.
// This classifier is the one place that decides, so that no call ever leaves
// with an empty body when the caller passed a value: it is either sent, or
// refused with a TypeError that execute()'s setup catch turns into a Result.
// =============================================================================

import { isReadableStream, isSpecialBody } from './special-body.js'

export type ClassifiedParams =
  | { kind: 'fields'; fields: Record<string, unknown> }
  | { kind: 'whole'; value: unknown }

/** A readable name for an error message: `Map`, `Money`, `object`. */
function typeName(value: object): string {
  const name = (value as { constructor?: { name?: unknown } }).constructor?.name
  return typeof name === 'string' && name !== '' ? name : 'object'
}

/**
 * @param params - The call's params, as passed.
 * @param asQuery - Whether this request's params go in the query string.
 * @throws TypeError for a value that has no honest wire form here.
 */
export function classifyParams(params: unknown, asQuery: boolean): ClassifiedParams {
  if (params === null || params === undefined) return { kind: 'fields', fields: {} }

  if (isSpecialBody(params)) {
    // A binary view or a stream cannot become query pairs. Strings, FormData,
    // Blob, ArrayBuffer and URLSearchParams keep their pre-5.0.1 GET behaviour.
    if (asQuery && (ArrayBuffer.isView(params) || isReadableStream(params))) {
      throw new TypeError(
        `Cannot send a ${typeName(params as object)} as params for a request whose params go in the query string. ` +
        'Send it with POST, PUT or PATCH.'
      )
    }
    return { kind: 'whole', value: params }
  }

  // Primitives and arrays keep their pre-5.0.1 behaviour (out of scope).
  if (typeof params !== 'object' || Array.isArray(params)) {
    return { kind: 'fields', fields: params as Record<string, unknown> }
  }

  if (params instanceof Map) {
    for (const key of params.keys()) {
      if (typeof key !== 'string') {
        throw new TypeError('Cannot send a Map with non-string keys as request params. Use string keys, or convert it to an object first.')
      }
    }
    return { kind: 'fields', fields: Object.fromEntries(params) as Record<string, unknown> }
  }

  if (params instanceof Set) {
    throw new TypeError('Cannot send a Set as request params. Put it in an object as an array, e.g. { ids: [...set] }.')
  }

  if (params instanceof Date) {
    throw new TypeError('Cannot send a Date as request params on its own. Put it in an object, e.g. { since: date.toISOString() }.')
  }

  const proto = Object.getPrototypeOf(params) as unknown
  if (proto === Object.prototype || proto === null || Object.keys(params).length > 0) {
    return { kind: 'fields', fields: params as Record<string, unknown> }
  }

  // A class instance with no own enumerable fields: its content is private
  // state. toJSON is the class saying how it wants to be sent.
  if (typeof (params as { toJSON?: unknown }).toJSON === 'function') {
    if (asQuery) {
      throw new TypeError(
        `Cannot send a ${typeName(params)} in a query string. Send it with POST, PUT or PATCH, or pass its fields as a plain object.`
      )
    }
    return { kind: 'whole', value: params }
  }

  throw new TypeError(
    `Cannot send a ${typeName(params)} as request params: it has no fields to send. Pass a plain object, or give the class a toJSON() method.`
  )
}
