import { describe, it, expect } from 'vitest'
import { mergeHeaders } from '../src/utils/headers.js'

describe('mergeHeaders', () => {
  it('joins a name repeated within one source, as Headers does', () => {
    const h = mergeHeaders([['Accept', 'application/json'], ['Accept', 'text/plain']])
    expect(h.get('accept')).toBe('application/json, text/plain')
  })

  it('a later source still replaces an earlier one', () => {
    const h = mergeHeaders({ Accept: 'a' }, [['Accept', 'b'], ['Accept', 'c']])
    expect(h.get('accept')).toBe('b, c')
  })

  it('accepts Headers, arrays and records', () => {
    const h = mergeHeaders(new Headers({ A: '1' }), [['B', '2']], { C: '3' })
    const pairs: [string, string][] = []
    h.forEach((value, name) => pairs.push([name, value]))
    expect(pairs).toEqual([['a', '1'], ['b', '2'], ['c', '3']])
  })
})
