// deepFreeze (5.5.0): cacheMiddleware freezes the data it stores, so a caller can't change it
// for every later hit. Only plain data is frozen; anything else is left as it is, untouched.
import { describe, it, expect } from 'vitest'
import { deepFreeze } from '../src/utils/freeze.js'

describe('deepFreeze', () => {
  it('freezes nested plain objects and arrays', () => {
    const v = { a: { b: [1, { c: 2 }] }, n: Object.create(null) as Record<string, unknown> }
    v.n.x = { y: 1 }
    deepFreeze(v)
    for (const o of [v, v.a, v.a.b, v.a.b[1], v.n, v.n.x]) expect(Object.isFrozen(o)).toBe(true)
  })

  it('leaves non-plain values untouched and usable', () => {
    class Thing { x = 1 }
    const date = new Date(0), map = new Map([[1, 1]]), u8 = new Uint8Array(2), blob = new Blob(['x']), thing = new Thing()
    const fn = () => 1
    const v = { date, map, u8, blob, thing, fn, inner: { deeper: thing } }
    expect(() => deepFreeze(v)).not.toThrow()
    for (const o of [date, map, u8, blob, thing, fn]) expect(Object.isFrozen(o)).toBe(false)
    date.setTime(5); map.set(2, 2); u8[0] = 1; thing.x = 2
    expect([date.getTime(), map.size, u8[0], thing.x]).toEqual([5, 2, 1, 2])
    expect(Object.isFrozen(v.inner)).toBe(true)
  })

  it('handles cycles', () => {
    const v: { a: { self?: unknown } } = { a: {} }
    v.a.self = v
    deepFreeze(v)
    expect(Object.isFrozen(v.a)).toBe(true)
  })

  it('enters an already-frozen parent', () => {
    const child = { x: 1 }
    deepFreeze(Object.freeze({ child }))
    expect(Object.isFrozen(child)).toBe(true)
  })

  it('accepts primitives, null and undefined', () => {
    for (const p of [1, 'x', null, undefined, true, 1n]) expect(() => deepFreeze(p)).not.toThrow()
  })

  it('never throws on a throwing getter, and still freezes the rest', () => {
    const ok = {}
    const v = { get bad(): unknown { throw new Error('x') }, ok }
    expect(() => deepFreeze(v)).not.toThrow()
    expect(Object.isFrozen(ok)).toBe(true)
  })

  it('never throws on a Proxy whose traps throw', () => {
    const p = new Proxy({}, { ownKeys() { throw new Error('x') }, preventExtensions() { throw new Error('y') } })
    expect(() => deepFreeze({ p })).not.toThrow()
  })

  it('a frozen value rejects writes in strict code', () => {
    const v = { a: [1] }
    deepFreeze(v)
    expect(() => { v.a.push(2) }).toThrow(TypeError)
  })
})
