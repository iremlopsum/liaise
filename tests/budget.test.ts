import { describe, it, expect } from 'vitest'
import { resolveBudget } from '../src/utils/budget.js'
import { timeoutSignalFor } from '../src/utils/timeout.js'

describe('resolveBudget', () => {
  it('gives an unshared call one signal covering both roles', () => {
    const b = resolveBudget(undefined, 50, undefined, undefined, false)
    expect(b.operation).toBeInstanceOf(AbortSignal)
    expect(b.perCaller).toBe(b.operation)
  })

  it('keeps a per-call timeout out of the shared operation', () => {
    const b = resolveBudget(20, undefined, undefined, undefined, true)
    expect(b.operation).toBeUndefined()
    expect(b.perCaller).toBeInstanceOf(AbortSignal)
  })

  it('lets a per-request timeout bound the shared operation', () => {
    const b = resolveBudget(undefined, 50, undefined, undefined, true)
    expect(b.operation).toBeInstanceOf(AbortSignal)
  })

  it('merges the caller signal into the per-caller budget', () => {
    const c = new AbortController()
    const b = resolveBudget(undefined, undefined, undefined, c.signal, true)
    expect(b.perCaller).toBe(c.signal)
  })

  it('returns undefined for both when nothing is configured', () => {
    const b = resolveBudget(undefined, undefined, undefined, undefined, false)
    expect(b.operation).toBeUndefined()
    expect(b.perCaller).toBeUndefined()
  })
})

describe('timeoutSignalFor', () => {
  it('falls back call → request → client, and 0 stops the fallback', () => {
    expect(timeoutSignalFor(undefined, undefined, 50)).toBeDefined()
    expect(timeoutSignalFor(undefined, 0, 50)).toBeUndefined()
    expect(timeoutSignalFor(0, 100, 50)).toBeUndefined()
    expect(timeoutSignalFor(undefined, undefined, undefined)).toBeUndefined()
  })
})
