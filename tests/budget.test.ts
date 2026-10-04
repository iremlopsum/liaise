import { describe, it, expect } from 'vitest'
import { operationBudget, callBudget } from '../src/utils/budget.js'
import { timeoutSignalFor } from '../src/utils/timeout.js'

describe('operationBudget', () => {
  it('returns undefined when there is neither a signal nor a timeout', () => {
    expect(operationBudget(undefined, undefined, undefined, undefined)).toBeUndefined()
  })

  it("returns the caller's own signal unchanged when no timeout applies", () => {
    const c = new AbortController()
    expect(operationBudget(undefined, undefined, undefined, c.signal)).toBe(c.signal)
  })

  it('merges the caller signal with the resolved timeout', () => {
    const c = new AbortController()
    const s = operationBudget(undefined, 5000, undefined, c.signal)
    expect(s).toBeInstanceOf(AbortSignal)
    expect(s).not.toBe(c.signal)
    c.abort(new Error('mine'))
    expect(s!.aborted).toBe(true)
    expect((s!.reason as Error).message).toBe('mine')
  })

  it('falls back call → request → client, and 0 at the first defined level means none', async () => {
    // Each case leaves exactly one level able to fire within the test.
    const fires = async (s: AbortSignal | undefined) => {
      if (!s) return false
      await new Promise(r => setTimeout(r, 30))
      return s.aborted
    }
    expect(await fires(operationBudget(10, 60_000, 60_000, undefined))).toBe(true)
    expect(await fires(operationBudget(undefined, 10, 60_000, undefined))).toBe(true)
    expect(await fires(operationBudget(undefined, undefined, 10, undefined))).toBe(true)
    expect(operationBudget(undefined, 0, 10, undefined)).toBeUndefined()
    expect(operationBudget(0, 10, 10, undefined)).toBeUndefined()
  })
})

describe('callBudget', () => {
  it("exposes the endpoint's or client's deadline, and aborts with that very reason", async () => {
    const c = new AbortController()
    const b = callBudget(undefined, 10, 60_000, c.signal)
    expect(b.endpointDeadline).toBeInstanceOf(AbortSignal)
    await new Promise(r => setTimeout(r, 30))
    expect(b.signal!.aborted).toBe(true)
    expect(b.signal!.reason).toBe(b.endpointDeadline!.reason)
    expect(callBudget(undefined, undefined, 10, undefined).endpointDeadline).toBeInstanceOf(AbortSignal)
  })

  it('treats an untyped `timeout: null` as no per-call timeout, as timeoutSignalFor does', () => {
    const b = callBudget(null as unknown as undefined, 10, undefined, undefined)
    expect(b.signal).toBeInstanceOf(AbortSignal)
    expect(b.endpointDeadline).toBe(b.signal)
  })

  it('has no endpoint deadline when the call sets its own timeout, or nothing applies', () => {
    expect(callBudget(50, 10, 10, undefined).endpointDeadline).toBeUndefined()
    expect(callBudget(0, 10, 10, undefined).endpointDeadline).toBeUndefined()
    expect(callBudget(undefined, 0, 10, undefined).endpointDeadline).toBeUndefined()
    expect(callBudget(undefined, undefined, undefined, undefined)).toEqual({ signal: undefined, endpointDeadline: undefined })
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
