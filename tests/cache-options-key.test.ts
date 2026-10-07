import { describe, it, expect } from 'vitest'
import { cacheOptionsKey } from '../src/utils/cache.js'

// The cache keys fetch options with its own keyer, not stableKey: options
// reach fetch by reference, so an object that isn't plain (an undici Agent)
// is the same option only when it is the same object.
describe('cacheOptionsKey', () => {
  it('keys strings, booleans, null and finite numbers by value', () => {
    expect(cacheOptionsKey({ a: 'x', b: 1, c: true, d: null })).toBe('{"a":"x","b":1,"c":true,"d":null}')
    expect(cacheOptionsKey({ a: '1' })).not.toBe(cacheOptionsKey({ a: 1 }))
    expect(cacheOptionsKey({ a: 'true' })).not.toBe(cacheOptionsKey({ a: true }))
    expect(cacheOptionsKey({ a: 'null' })).not.toBe(cacheOptionsKey({ a: null }))
  })

  it('drops an undefined member', () => {
    expect(cacheOptionsKey({ a: undefined, b: 1 })).toBe(cacheOptionsKey({ b: 1 }))
  })

  it('keys a plain object by content, keys sorted, at any depth', () => {
    expect(cacheOptionsKey({ b: 1, a: { d: 2, c: 3 } })).toBe(cacheOptionsKey({ a: { c: 3, d: 2 }, b: 1 }))
    expect(cacheOptionsKey({ a: { c: 3 } })).not.toBe(cacheOptionsKey({ a: { c: 4 } }))
    const bare = Object.create(null) as Record<string, unknown>
    bare.c = 3
    expect(cacheOptionsKey({ a: bare })).toBe(cacheOptionsKey({ a: { c: 3 } }))
  })

  it('keys an array by content, in order', () => {
    expect(cacheOptionsKey({ tags: ['a', 'b'] })).toBe(cacheOptionsKey({ tags: ['a', 'b'] }))
    expect(cacheOptionsKey({ tags: ['a', 'b'] })).not.toBe(cacheOptionsKey({ tags: ['b', 'a'] }))
    expect(cacheOptionsKey({ tags: ['a'] })).not.toBe(cacheOptionsKey({ tags: '["a"]' }))
    expect(cacheOptionsKey({ tags: [] })).not.toBe(cacheOptionsKey({ tags: {} }))
  })

  it('keys any other object by identity: stable for one object, different for two that look alike', () => {
    class Agent {
      _events = {}
      #cert: string
      constructor(cert: string) { this.#cert = cert }
      cert() { return this.#cert }
    }
    const a = new Agent('a')
    const b = new Agent('b')
    const keyA = cacheOptionsKey({ dispatcher: a })
    expect(keyA).not.toBeNull()
    expect(cacheOptionsKey({ dispatcher: a })).toBe(keyA)
    expect(cacheOptionsKey({ dispatcher: b })).not.toBeNull()
    expect(cacheOptionsKey({ dispatcher: b })).not.toBe(keyA)
  })

  it('keys a Map, a Date and a function by identity too', () => {
    const map = new Map([['a', 1]])
    const date = new Date(0)
    const fn = () => 1
    expect(cacheOptionsKey({ x: map })).toBe(cacheOptionsKey({ x: map }))
    expect(cacheOptionsKey({ x: map })).not.toBe(cacheOptionsKey({ x: new Map([['a', 1]]) }))
    expect(cacheOptionsKey({ x: date })).toBe(cacheOptionsKey({ x: date }))
    expect(cacheOptionsKey({ x: date })).not.toBe(cacheOptionsKey({ x: new Date(0) }))
    expect(cacheOptionsKey({ x: fn })).toBe(cacheOptionsKey({ x: fn }))
    expect(cacheOptionsKey({ x: fn })).not.toBe(cacheOptionsKey({ x: () => 1 }))
  })

  it('an identity token cannot collide with a string', () => {
    const agent = new (class Agent {})()
    const key = cacheOptionsKey({ dispatcher: agent })
    expect(key).toMatch(/^\{"dispatcher":.+\}$/)
    // The token's text, as a string option: `#1` for a token `#1` or `"#1"`.
    const text = String(key).slice('{"dispatcher":'.length, -1).replace(/^"|"$/g, '')
    expect(cacheOptionsKey({ dispatcher: text })).not.toBe(key)
  })

  it('declines a circular structure', () => {
    const o: Record<string, unknown> = {}
    o.self = o
    expect(cacheOptionsKey({ next: o })).toBeNull()
    const list: unknown[] = []
    list.push(list)
    expect(cacheOptionsKey({ tags: list })).toBeNull()
  })

  it('keys a shared, non-circular reference', () => {
    const shared = { revalidate: 60 }
    expect(cacheOptionsKey({ a: shared, b: shared })).toBe('{"a":{"revalidate":60},"b":{"revalidate":60}}')
  })

  it('declines a BigInt, a symbol and a non-finite number', () => {
    expect(cacheOptionsKey({ a: BigInt(1) })).toBeNull()
    expect(cacheOptionsKey({ a: Symbol('s') })).toBeNull()
    expect(cacheOptionsKey({ a: NaN })).toBeNull()
    expect(cacheOptionsKey({ a: Infinity })).toBeNull()
    expect(cacheOptionsKey({ a: [-Infinity] })).toBeNull()
  })

  it('declines on a throwing getter instead of throwing', () => {
    const options = { get credentials(): string { throw new Error('boom') } }
    expect(() => cacheOptionsKey(options)).not.toThrow()
    expect(cacheOptionsKey(options)).toBeNull()
  })
})
