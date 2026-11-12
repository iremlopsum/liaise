import { describe, it, expect } from 'vitest'
import { operationTypeOf } from '../src/utils/operation-type.js'

describe('operationTypeOf', () => {
  it.each([
    ['query GetUser { user { id } }', 'query'],
    ['{ user { id } }', 'query'],
    ['  \n# mutation in a comment\nquery Q { a }', 'query'],
    ['query Q($s: String = "mutation") { a(s: $s) }', 'query'],
    ['mutation M { createUser { id } }', 'mutation'],
    ['fragment F on User { id }\nmutation M { createUser { ...F } }', 'mutation'],
    ['fragment F on User { id }\nquery Q { user { ...F } }', 'query'],
    ['fragment F on User { a(s: "}") }\nquery Q { user { ...F } }', 'query'],
    ['"""mutation"""\nquery Q { a }', 'query'],
    [',,query Q { a }', 'query'],
    ['subscription S { tick }', 'mutation'],
    ['', 'mutation'],
    ['not graphql at all', 'mutation'],
    ['fragment F on User { id }', 'mutation'],
    ['queryX { a }', 'mutation'],
    // Found in review: a fragment header holding `{` inside arguments or a comment.
    ['fragment F on User @argumentDefinitions(count: {type: "Int", defaultValue: 10}) { id }\nmutation Charge { charge { id } }', 'mutation'],
    ['fragment F on User # used by {UserCard}\n{ id }\nmutation Charge { charge { id } }', 'mutation'],
    ['fragment F on User @x(list: [{a: 1}]) { id }\nquery Q { user { ...F } }', 'query'],
    // Anything at the top level that isn't a name, a comment, a string or `{` is unreadable.
    ['@query { a }', 'mutation'],
    ['équery { a }', 'mutation'],
    ['} query Q { a }', 'mutation'],
  ])('%j → %s', (doc, expected) => {
    expect(operationTypeOf(doc)).toBe(expected)
  })

  it('never throws on any string, and on a non-string from plain JS', () => {
    expect(operationTypeOf('{{{{')).toBe('query')
    expect(operationTypeOf('fragment F on T {{{')).toBe('mutation')
    expect(operationTypeOf('"unterminated')).toBe('mutation')
    expect(operationTypeOf(42 as unknown as string)).toBe('mutation')
    expect(operationTypeOf(null as unknown as string)).toBe('mutation')
  })
})
