import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApi, createGraphQL, defineRequest, Operation, gql, poll } from '../src/index.js'
import { mockFetch, jsonResponse } from '../src/testing.js'
import type { Result } from '../src/index.js'

type Stats = { n: number }
let mock: ReturnType<typeof mockFetch>
let served = 0

/** A client whose GET /stats answers { n: 1 }, { n: 2 }, … unless routes say otherwise. */
function client(routes?: Parameters<typeof mockFetch>[0]) {
  served = 0
  mock = mockFetch(routes ?? { 'GET /stats': () => jsonResponse({ n: ++served }) })
  mock.install()
  const getStats = defineRequest<Stats, { a?: number }>()({ method: 'GET', path: '/stats' })
  return createApi({ baseUrl: 'https://api.test', requests: { getStats } })
}
const ns = (results: Result<Stats>[]) => results.map(r => (r.error ? r.error.status : r.data.n))
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { mock?.restore(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('poll: the interval', () => {
  it('asks at once, then every ms after each response, until stop()', async () => {
    const api = client()
    const seen: Result<Stats>[] = []
    const stop = poll(api.getStats, {}, r => seen.push(r), { every: 1000 })
    await flush()
    expect(ns(seen)).toEqual([1])
    await vi.advanceTimersByTimeAsync(999)
    expect(ns(seen)).toEqual([1])
    await vi.advanceTimersByTimeAsync(1)
    expect(ns(seen)).toEqual([1, 2])
    stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(ns(seen)).toEqual([1, 2])
    expect(mock.calls).toHaveLength(2)
  })

  it('never overlaps: a slow response delays the next request', async () => {
    const api = client({ 'GET /stats': () => new Promise(r => setTimeout(() => r(jsonResponse({ n: ++served })), 3000)) })
    const stop = poll(api.getStats, {}, () => {}, { every: 1000 })
    await vi.advanceTimersByTimeAsync(3999)
    expect(mock.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mock.calls).toHaveLength(2)
    stop()
  })

  it("an every that isn't a positive finite number asks once", async () => {
    for (const every of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const api = client()
      const stop = poll(api.getStats, {}, () => {}, { every })
      await vi.advanceTimersByTimeAsync(120_000)
      expect(mock.calls, `every: ${every}`).toHaveLength(1)
      stop(); mock.restore()
    }
  })
})

describe('poll: sharing', () => {
  it('five callers asking the same thing share one request per tick', async () => {
    const api = client()
    const seen: Result<Stats>[][] = [[], [], [], [], []]
    const stops = seen.map(s => poll(api.getStats, {}, r => s.push(r), { every: 1000 }))
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(mock.calls).toHaveLength(2)
    for (const s of seen) expect(ns(s)).toEqual([1, 2])
    stops.forEach(stop => stop())
  })

  it('params compare by value', async () => {
    const api = client()
    const a = poll(api.getStats, { a: 1 }, () => {}, { every: 1000 })
    const b = poll(api.getStats, { a: 1 }, () => {}, { every: 1000 })
    await flush()
    expect(mock.calls).toHaveLength(1)
    a(); b()
  })

  it('different params, different headers or a different client do not share', async () => {
    const api = client()
    const other = createApi({ baseUrl: 'https://api.test', requests: { getStats: defineRequest<Stats>()({ method: 'GET', path: '/stats' }) } })
    const stops = [
      poll(api.getStats, { a: 1 }, () => {}, { every: 1000 }),
      poll(api.getStats, { a: 2 }, () => {}, { every: 1000 }),
      poll(api.getStats, { a: 1 }, () => {}, { every: 1000, headers: { 'x-tenant': 'b' } }),
      poll(other.getStats, {}, () => {}, { every: 1000 }),
    ]
    await flush()
    expect(mock.calls).toHaveLength(4)
    stops.forEach(stop => stop())
  })

  it('options that cannot be keyed (per-request middleware) get their own shared poll', async () => {
    const api = client()
    const pass = (_: unknown, next: () => Promise<Result<unknown>>) => next()
    const a = poll(api.getStats, {}, () => {}, { every: 1000, middleware: [pass] })
    const b = poll(api.getStats, {}, () => {}, { every: 1000, middleware: [pass] })
    await flush()
    expect(mock.calls).toHaveLength(2)
    a(); b()
  })

  it('a late joiner gets the last result in a microtask, not inside poll(), and no extra request', async () => {
    const api = client()
    const first = poll(api.getStats, {}, () => {}, { every: 1000 })
    await flush()
    const seen: Result<Stats>[] = []
    const late = poll(api.getStats, {}, r => seen.push(r), { every: 1000 })
    expect(seen).toEqual([])
    await Promise.resolve()
    expect(ns(seen)).toEqual([1])
    expect(mock.calls).toHaveLength(1)
    first(); late()
  })

  it('uses the shortest every, and lengthens again when that caller stops', async () => {
    const api = client()
    const slow = poll(api.getStats, {}, () => {}, { every: 5000 })
    const fast = poll(api.getStats, {}, () => {}, { every: 1000 })
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(mock.calls).toHaveLength(2)
    fast()
    await vi.advanceTimersByTimeAsync(1000)
    expect(mock.calls).toHaveLength(3) // the wait already scheduled with every 1000
    await vi.advanceTimersByTimeAsync(4999)
    expect(mock.calls).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(mock.calls).toHaveLength(4)
    slow()
  })

  it('mutating params after the call changes nothing', async () => {
    const api = client()
    const params = { a: 1 }
    const stop = poll(api.getStats, params, () => {}, { every: 1000 })
    params.a = 2
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(mock.calls.map(c => c.url)).toEqual(['https://api.test/stats?a=1', 'https://api.test/stats?a=1'])
    const joined = poll(api.getStats, { a: 1 }, () => {}, { every: 1000 })
    await flush()
    expect(mock.calls).toHaveLength(2) // joined the same shared poll: the key was computed from the copy
    stop(); joined()
  })
})

describe('poll: edge cases', () => {
  it('params that are not plain objects are sent and keyed as they are', async () => {
    const api = client()
    const stop = poll(api.getStats, new Map([['a', 1]]) as never, () => {}, { every: 1000 })
    await flush()
    expect(mock.calls[0].url).toBe('https://api.test/stats?a=1')
    stop()
  })

  it('two POST polls with different URLSearchParams bodies do not share', async () => {
    mock = mockFetch({ 'POST /form': () => jsonResponse({ ok: true }) })
    mock.install()
    const send = defineRequest<{ ok: boolean }, URLSearchParams>()({ method: 'POST', path: '/form' })
    const api = createApi({ baseUrl: 'https://api.test', requests: { send } })
    const stops = [
      poll(api.send, new URLSearchParams({ x: '1' }), () => {}, { every: 1000 }),
      poll(api.send, new URLSearchParams({ x: '2' }), () => {}, { every: 1000 }),
    ]
    await flush()
    expect(mock.calls).toHaveLength(2)
    stops.forEach(stop => stop())
  })

  it("a callback that joins the same question doesn't start a second loop", async () => {
    const api = client()
    const stops: Array<() => void> = []
    let joined = false
    stops.push(poll(api.getStats, {}, () => {
      if (!joined) { joined = true; stops.push(poll(api.getStats, {}, () => {}, { every: 1000 })) }
    }, { every: 1000 }))
    await vi.advanceTimersByTimeAsync(5000)
    expect(mock.calls).toHaveLength(6)
    stops.forEach(stop => stop())
    expect(vi.getTimerCount()).toBe(0)
  })

  it('an every beyond the timer limit is clamped, not fired at once', async () => {
    const api = client()
    const stop = poll(api.getStats, {}, () => {}, { every: 3e9 })
    await vi.advanceTimersByTimeAsync(2_000_000_000)
    expect(mock.calls).toHaveLength(1)
    stop()
  })
})

describe('poll: stopping', () => {
  it('stopping the last caller aborts the request in flight and delivers nothing', async () => {
    const signals: AbortSignal[] = []
    const api = client({ 'GET /stats': ({ request }) => { signals.push(request.signal); return new Promise(r => setTimeout(() => r(jsonResponse({ n: 1 })), 3000)) } })
    const seen: Result<Stats>[] = []
    const stop = poll(api.getStats, {}, r => seen.push(r), { every: 1000 })
    await vi.advanceTimersByTimeAsync(100)
    expect(signals[0].aborted).toBe(false)
    stop()
    expect(signals[0].aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(seen).toEqual([])
    expect(mock.calls).toHaveLength(1)
  })

  it('poll, stop, poll in the same tick leaves one shared poll and one request', async () => {
    const api = client()
    const seen: Result<Stats>[] = []
    poll(api.getStats, {}, r => seen.push(r), { every: 1000 })()
    const stop = poll(api.getStats, {}, r => seen.push(r), { every: 1000 })
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(seen).toHaveLength(2) // one delivery per tick, to the caller still there
    expect(mock.calls.length).toBeLessThanOrEqual(3) // the first poll's request, if it was sent, was aborted
    stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(seen).toHaveLength(2)
  })

  it("an aborted signal stops that caller, not the others", async () => {
    const api = client()
    const controller = new AbortController()
    const a: Result<Stats>[] = [], b: Result<Stats>[] = []
    poll(api.getStats, {}, r => a.push(r), { every: 1000, signal: controller.signal })
    const stopB = poll(api.getStats, {}, r => b.push(r), { every: 1000 })
    await flush()
    controller.abort()
    await vi.advanceTimersByTimeAsync(1000)
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(2)
    stopB()
  })

  it('an already-aborted signal: no request, no callback', async () => {
    const api = client()
    const seen: Result<Stats>[] = []
    const stop = poll(api.getStats, {}, r => seen.push(r), { every: 1000, signal: AbortSignal.abort() })
    await vi.advanceTimersByTimeAsync(5000)
    expect(seen).toEqual([])
    expect(mock.calls).toHaveLength(0)
    stop()
  })

  it('stopping the last caller clears its timer and its visibilitychange listener', async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    const add = vi.spyOn(doc, 'addEventListener')
    const remove = vi.spyOn(doc, 'removeEventListener')
    vi.stubGlobal('document', doc)
    const api = client()
    const stop = poll(api.getStats, {}, () => {}, { every: 1000 })
    await flush()
    expect(vi.getTimerCount()).toBe(1)
    stop()
    expect(vi.getTimerCount()).toBe(0)
    const added = add.mock.calls.find(c => c[0] === 'visibilitychange')![1]
    expect(remove).toHaveBeenCalledWith('visibilitychange', added)
  })

  it("stopping a caller removes its signal's abort listener", async () => {
    const api = client()
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, 'addEventListener')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const stop = poll(api.getStats, {}, () => {}, { every: 1000, signal: controller.signal })
    await flush()
    const added = add.mock.calls.find(c => c[0] === 'abort')![1]
    stop()
    expect(remove).toHaveBeenCalledWith('abort', added)
  })

  it("a callback that stops another caller during delivery means that caller gets nothing", async () => {
    const api = client()
    const b: Result<Stats>[] = []
    let stopB = () => {}
    poll(api.getStats, {}, () => stopB(), { every: 1000 })
    stopB = poll(api.getStats, {}, r => b.push(r), { every: 1000 })
    await flush()
    expect(b).toEqual([])
  })
})

describe('poll: a callback that throws', () => {
  it("doesn't stop the poll or the other callbacks, and goes to reportError", async () => {
    const reportError = vi.fn()
    vi.stubGlobal('reportError', reportError)
    const api = client()
    const seen: Result<Stats>[] = []
    const a = poll(api.getStats, {}, () => { throw new Error('boom') }, { every: 1000 })
    const b = poll(api.getStats, {}, r => seen.push(r), { every: 1000 })
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(ns(seen)).toEqual([1, 2])
    expect(reportError).toHaveBeenCalledTimes(2)
    expect(reportError.mock.calls[0][0]).toMatchObject({ message: 'boom' })
    a(); b()
  })

  it('goes to console.error where there is no reportError', async () => {
    vi.stubGlobal('reportError', undefined)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = client()
    const stop = poll(api.getStats, {}, () => { throw new Error('boom') }, { every: 1000 })
    await flush()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('poll'), expect.objectContaining({ message: 'boom' }))
    stop()
  })
})

describe('poll: backoff', () => {
  /** Answers with the given statuses in order, then 200s. */
  function sequence(statuses: number[], headers: Record<string, string> = {}) {
    let i = 0
    return client({ 'GET /stats': () => {
      const status = statuses[i++] ?? 200
      return status === 200 ? jsonResponse({ n: ++served }) : jsonResponse({ failed: true }, { status, headers })
    } })
  }
  /** Milliseconds between requests, from fake time. */
  async function gaps(max: number, step = 100) {
    await vi.advanceTimersByTimeAsync(0)
    const at: number[] = []
    let seen = 0
    for (let t = 0; t <= max; t += step) {
      if (mock.calls.length > seen) { at.push(t); seen = mock.calls.length }
      await vi.advanceTimersByTimeAsync(step)
    }
    return at.slice(1).map((t, i) => t - at[i])
  }

  it('doubles the wait after each failure in a row, and resets after a success', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999) // the top of the jitter range
    const api = sequence([500, 500, 500])
    const stop = poll(api.getStats, {}, () => {}, { every: 1000 })
    expect(await gaps(15_000)).toEqual([2000, 4000, 8000, 1000])
    stop()
  })

  it('never waits less than every after a failure, whatever the jitter', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const api = sequence([500, 500])
    const stop = poll(api.getStats, {}, () => {}, { every: 1000 })
    expect(await gaps(3500)).toEqual([1000, 1000, 1000])
    stop()
  })

  it('caps the wait at maxEvery, and at max(every, 60 000) by default', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)
    const capped = sequence([500, 500, 500, 500])
    const stop = poll(capped.getStats, {}, () => {}, { every: 1000, maxEvery: 3000 })
    expect(await gaps(10_000)).toEqual([2000, 3000, 3000])
    stop(); mock.restore()
    const byDefault = sequence(Array(8).fill(500))
    const stop2 = poll(byDefault.getStats, {}, () => {}, { every: 10_000 })
    expect((await gaps(400_000, 1000)).slice(0, 4)).toEqual([20_000, 40_000, 60_000, 60_000])
    stop2()
  })

  it('a Retry-After on a 429 raises the wait to at least that value', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const api = sequence([429], { 'retry-after': '10' })
    const stop = poll(api.getStats, {}, () => {}, { every: 1000 })
    expect((await gaps(12_000))[0]).toBe(10_000)
    stop()
  })
})

describe('poll: a hidden tab', () => {
  function tab() {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as 'visible' | 'hidden' })
    vi.stubGlobal('document', doc)
    return {
      hide() { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')) },
      show() { doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')) },
    }
  }

  it('pauses while hidden and asks at once when visible again', async () => {
    const t = tab()
    const api = client()
    const stop = poll(api.getStats, {}, () => {}, { every: 1000 })
    await flush()
    t.hide()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mock.calls).toHaveLength(1)
    t.show()
    await flush()
    expect(mock.calls).toHaveLength(2)
    stop()
  })

  it('keeps polling while hidden if any caller set inBackground', async () => {
    const t = tab()
    const api = client()
    const a = poll(api.getStats, {}, () => {}, { every: 1000 })
    const b = poll(api.getStats, {}, () => {}, { every: 1000, inBackground: true })
    await flush()
    t.hide()
    await vi.advanceTimersByTimeAsync(3000)
    expect(mock.calls).toHaveLength(4)
    a(); b()
  })

  it('the last inBackground caller leaving while hidden pauses the poll', async () => {
    const t = tab()
    const api = client()
    const a = poll(api.getStats, {}, () => {}, { every: 1000 })
    const b = poll(api.getStats, {}, () => {}, { every: 1000, inBackground: true })
    await flush()
    t.hide()
    b()
    await vi.advanceTimersByTimeAsync(5000)
    expect(mock.calls).toHaveLength(1)
    a()
  })

  it('joining a hidden tab sends nothing until it is visible', async () => {
    const t = tab()
    t.hide()
    const api = client()
    const stop = poll(api.getStats, {}, () => {}, { every: 1000 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(mock.calls).toHaveLength(0)
    t.show()
    await flush()
    expect(mock.calls).toHaveLength(1)
    stop()
  })

  it('never pauses where there is no document', async () => {
    const api = client()
    const stop = poll(api.getStats, {}, () => {}, { every: 1000 })
    await flush()
    await vi.advanceTimersByTimeAsync(3000)
    expect(mock.calls).toHaveLength(4)
    stop()
  })
})

describe('poll: any liaise endpoint', () => {
  it('polls a GraphQL operation like a REST endpoint', async () => {
    mock = mockFetch({ 'POST /graphql': () => jsonResponse({ data: { stats: { n: ++served } } }) })
    mock.install()
    served = 0
    const getStats = new Operation<Record<string, never>, { stats: Stats }>({ operation: gql`query GetStats { stats { n } }` })
    const graph = createGraphQL({ endpoint: 'https://api.test/graphql', operations: { getStats } })
    const seen: number[] = []
    const stop = poll(graph.getStats, {}, r => { if (!r.error) seen.push(r.data.stats.n) }, { every: 1000 })
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(seen).toEqual([1, 2])
    stop()
  })

  it('a Pollable that throws becomes a middleware error Result, delivered, and polling goes on', async () => {
    const reportError = vi.fn()
    vi.stubGlobal('reportError', reportError)
    let calls = 0
    const flaky = async () => { calls++; if (calls === 1) throw new Error('not a liaise endpoint'); return { data: { n: calls }, error: null } as unknown as Result<Stats> }
    const seen: Result<Stats>[] = []
    const stop = poll(flaky, {}, r => seen.push(r), { every: 1000 })
    await flush()
    await vi.advanceTimersByTimeAsync(2000)
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'not a liaise endpoint' }))
    expect(seen[0].error?.kind).toBe('middleware')
    expect(seen[1].error).toBeNull()
    stop()
  })
})
