import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createApi, createGraphQL, defineRequest, Operation, gql, poll } from '../src/index.js'
import { mockFetch, jsonResponse, successResult } from '../src/testing.js'
import type { CallOptions, Middleware, Result } from '../src/index.js'

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
/** Polls are shared only where there is a `window` (browsers, React Native). Node has none, so a test of sharing stubs one. */
const shareable = () => vi.stubGlobal('window', globalThis)
/** A browser: errors go to `reportError` only where there is a `document`. */
const inBrowser = () => vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))

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

  it("an every below 1, or one that isn't finite, asks once", async () => {
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
  beforeEach(shareable)

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

  it('a late joiner that stops before its microtask runs gets nothing (Strict Mode beside a shared poll)', async () => {
    const api = client()
    const first = poll(api.getStats, {}, () => {}, { every: 1000 })
    await flush()
    const seen: Result<Stats>[] = []
    poll(api.getStats, {}, r => seen.push(r), { every: 1000 })()
    const again = poll(api.getStats, {}, r => seen.push(r), { every: 1000 })
    await flush()
    expect(ns(seen)).toEqual([1]) // one delivery, to the caller still there
    expect(mock.calls).toHaveLength(1)
    first(); again()
  })

  it('a late joiner never gets an older answer after a newer one', async () => {
    // The joiner arrives 0 to 5 microtasks after the second answer is returned, so one of
    // them lands between that answer and the microtask that hands it the first one.
    for (let hops = 0; hops < 6; hops++) {
      let n = 0
      const late: number[] = []
      const stops: Array<() => void> = []
      const endpoint = async () => {
        n++
        if (n === 2) {
          let p = Promise.resolve()
          for (let i = 0; i < hops; i++) p = p.then(() => {})
          void p.then(() => stops.push(poll(endpoint, {}, r => { if (!r.error) late.push(r.data.n) }, { every: 1000 })))
        }
        return successResult({ n })
      }
      stops.push(poll(endpoint, {}, () => {}, { every: 1000 }))
      await vi.advanceTimersByTimeAsync(2500)
      expect(late.length, `${hops} hops`).toBeGreaterThan(1)
      expect(late, `${hops} hops`).toEqual([...new Set(late)].sort((a, b) => a - b))
      stops.forEach(stop => stop())
    }
  })

  it('a joiner with a shorter every leaves a backoff wait as it is', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)
    const api = client({ 'GET /stats': () => jsonResponse({ failed: true }, { status: 500 }) })
    const a = poll(api.getStats, {}, () => {}, { every: 1000 })
    await flush() // a 500 at 0 ms: the next request waits 2000 ms
    await vi.advanceTimersByTimeAsync(100)
    const b = poll(api.getStats, {}, () => {}, { every: 100 })
    await vi.advanceTimersByTimeAsync(1800)
    expect(mock.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(mock.calls).toHaveLength(2)
    a(); b()
  })

  it('an every: 0 caller beside a repeating one gets one callback, then leaves', async () => {
    const api = client()
    const once: Result<Stats>[] = []
    const repeating = poll(api.getStats, {}, () => {}, { every: 100 })
    poll(api.getStats, {}, r => once.push(r), { every: 0 })
    await vi.advanceTimersByTimeAsync(550)
    expect(ns(once)).toEqual([1])
    expect(mock.calls.length).toBeGreaterThan(5)
    repeating()
  })

  it('an ask-once caller never stopped leaves no timer, visibilitychange listener, abort listener or shared poll behind', async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    const add = vi.spyOn(doc, 'addEventListener')
    const remove = vi.spyOn(doc, 'removeEventListener')
    vi.stubGlobal('document', doc)
    const controller = new AbortController()
    const removeAbort = vi.spyOn(controller.signal, 'removeEventListener')
    const api = client()
    poll(api.getStats, {}, () => {}, { every: 0, signal: controller.signal })
    await flush()
    expect(mock.calls).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
    const added = add.mock.calls.find(c => c[0] === 'visibilitychange')![1]
    expect(remove).toHaveBeenCalledWith('visibilitychange', added)
    expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function))
    poll(api.getStats, {}, () => {}, { every: 0 })
    await flush()
    expect(mock.calls).toHaveLength(2) // a new shared poll, which asks afresh
  })
})

describe('poll: sharing needs a window', () => {
  /** A server's client: a middleware adds the token of the user whose request is being handled. */
  function perUser() {
    const user = new AsyncLocalStorage<string>()
    mock = mockFetch({ 'GET /me': ({ request }) => jsonResponse({ owner: request.headers.get('authorization') }) })
    mock.install()
    const auth: Middleware = (ctx, next) => { ctx.request.headers.set('authorization', `Bearer ${user.getStore()}`); return next() }
    const getMe = defineRequest<{ owner: string }>()({ method: 'GET', path: '/me' })
    const api = createApi({ baseUrl: 'https://api.test', middleware: [auth], requests: { getMe } })
    const seen: Record<string, Array<string | null>> = { alice: [], bob: [] }
    const stops = ['alice', 'bob'].map(name =>
      user.run(name, () => poll(api.getMe, {}, r => seen[name].push(r.error ? null : r.data.owner), { every: 1000 })))
    return { seen, stops }
  }

  it("on a server (no window) identical callers don't share: each gets its own requests, with its own middleware", async () => {
    expect(typeof window).toBe('undefined')
    const { seen, stops } = perUser()
    await flush()
    expect(seen).toEqual({ alice: ['Bearer alice'], bob: ['Bearer bob'] })
    await vi.advanceTimersByTimeAsync(1000)
    expect(mock.calls).toHaveLength(4) // two requests per tick
    stops.forEach(stop => stop())
  })

  it('in a browser (a window) the same callers share one request per tick', async () => {
    shareable()
    const { seen, stops } = perUser()
    await flush()
    expect(seen).toEqual({ alice: ['Bearer alice'], bob: ['Bearer alice'] })
    await vi.advanceTimersByTimeAsync(1000)
    expect(mock.calls).toHaveLength(2)
    stops.forEach(stop => stop())
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
    shareable()
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
    shareable()
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
    const spy = vi.spyOn(globalThis, 'setTimeout')
    const stop = poll(api.getStats, {}, () => {}, { every: 3e9 })
    await flush()
    expect(mock.calls).toHaveLength(1)
    expect(spy.mock.calls.at(-1)?.[1]).toBe(2_147_483_647)
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
    shareable()
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
    shareable()
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
    shareable()
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
  it("doesn't stop the poll or the other callbacks, and goes to reportError in a browser", async () => {
    shareable()
    inBrowser()
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

  it('goes to console.error, not reportError, where there is no document (Deno, Bun, Node)', async () => {
    const reportError = vi.fn()
    vi.stubGlobal('reportError', reportError)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = client()
    const stop = poll(api.getStats, {}, () => { throw new Error('boom') }, { every: 1000 })
    await flush()
    expect(reportError).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('[liaise] poll: the callback failed:', expect.objectContaining({ message: 'boom' }))
    stop()
  })

  it('console.error names what failed: an endpoint that throws is not called a callback', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const down = async (): Promise<Result<Stats>> => { throw new Error('down') }
    const stop = poll(down, {}, () => {}, { every: 1000 })
    await flush()
    expect(log).toHaveBeenCalledWith('[liaise] poll: the endpoint failed:', expect.objectContaining({ message: 'down' }))
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

  it('a Retry-After on a 503 raises the wait the same way', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const api = sequence([503], { 'retry-after': '10' })
    const stop = poll(api.getStats, {}, () => {}, { every: 1000 })
    expect((await gaps(12_000))[0]).toBe(10_000)
    stop()
  })

  it('maxEvery caps a Retry-After too', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const api = sequence([429], { 'retry-after': '600' })
    const stop = poll(api.getStats, {}, () => {}, { every: 1000, maxEvery: 3000 })
    expect((await gaps(5000))[0]).toBe(3000)
    stop()
  })

  it('callers sharing a poll use the smallest maxEvery', async () => {
    shareable()
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)
    const api = sequence([500, 500, 500, 500])
    const a = poll(api.getStats, {}, () => {}, { every: 1000, maxEvery: 5000 })
    const b = poll(api.getStats, {}, () => {}, { every: 1000, maxEvery: 3000 })
    expect(await gaps(10_000)).toEqual([2000, 3000, 3000])
    a(); b()
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
    shareable()
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
    shareable()
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

  it('a Retry-After still running when the tab is shown again is waited out', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    // Hidden after the 429 arrives, and hidden while it is in flight.
    for (const hideFirst of [false, true]) {
      const t = tab()
      let i = 0
      const api = client({ 'GET /stats': () => (i++ === 0 ? jsonResponse({}, { status: 429, headers: { 'retry-after': '10' } }) : jsonResponse({ n: i })) })
      const stop = poll(api.getStats, {}, () => {}, { every: 1000 })
      if (hideFirst) t.hide()
      await flush() // 0 ms: a 429 with Retry-After: 10
      await vi.advanceTimersByTimeAsync(100)
      t.hide()
      await vi.advanceTimersByTimeAsync(100)
      t.show() // 200 ms
      await flush()
      expect(mock.calls, `hidden ${hideFirst ? 'in flight' : 'after'}`).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(9799)
      expect(mock.calls).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1) // 10 000 ms
      expect(mock.calls).toHaveLength(2)
      stop(); mock.restore()
    }
  })

  it('a Retry-After shorter than the backoff wait is still waited out when the tab is shown', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999) // a backoff wait of 2000 ms
    const t = tab()
    let i = 0
    const api = client({ 'GET /stats': () => (i++ === 0 ? jsonResponse({}, { status: 503, headers: { 'retry-after': '1' } }) : jsonResponse({ n: i })) })
    const stop = poll(api.getStats, {}, () => {}, { every: 1000 })
    await flush() // 0 ms: a 503 with Retry-After: 1
    t.hide()
    await vi.advanceTimersByTimeAsync(500)
    t.show() // 500 ms: the Retry-After has 500 ms left
    await vi.advanceTimersByTimeAsync(499)
    expect(mock.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1) // 1000 ms
    expect(mock.calls).toHaveLength(2)
    stop()
  })

  it('after a failure without Retry-After, a tab shown again asks at once', async () => {
    const t = tab()
    const api = client({ 'GET /stats': () => jsonResponse({}, { status: 500 }) })
    const stop = poll(api.getStats, {}, () => {}, { every: 1000 })
    await flush()
    t.hide()
    t.show()
    await flush()
    expect(mock.calls).toHaveLength(2)
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
    inBrowser()
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

describe('poll: never throws, whatever it is given', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })

  it('no options: reports it, sends nothing, and returns a stop that does nothing', async () => {
    const api = client()
    let stop: unknown
    expect(() => { stop = poll(api.getStats, {}, () => {}, undefined as never) }).not.toThrow()
    expect(stop).toBeTypeOf('function')
    await vi.advanceTimersByTimeAsync(5000)
    expect(mock.calls).toHaveLength(0)
    expect(console.error).toHaveBeenCalledTimes(1)
    expect(() => (stop as () => void)()).not.toThrow()
  })

  it('params that are undefined or null are passed on as they are', async () => {
    shareable()
    const passed: unknown[] = []
    const endpoint = async (params: unknown) => { passed.push(params); return successResult({ n: 1 }) }
    for (const params of [undefined, null]) {
      let stop = () => {}
      expect(() => { stop = poll(endpoint, params as never, () => {}, { every: 1000 }) }).not.toThrow()
      await flush()
      stop()
    }
    expect(passed).toEqual([undefined, null])
    const api = client()
    const seen: Result<Stats>[] = []
    const stop = poll(api.getStats, undefined as never, r => seen.push(r), { every: 1000 })
    await flush()
    expect(ns(seen)).toEqual([1])
    stop()
  })

  it('an endpoint that is not a function: each request becomes a middleware error', async () => {
    shareable()
    const seen: Result<unknown>[] = []
    let stop = () => {}
    expect(() => { stop = poll(undefined as never, {}, r => seen.push(r), { every: 1000 }) }).not.toThrow()
    await flush()
    expect(seen.map(r => r.error?.kind)).toEqual(['middleware'])
    stop()
  })

  it('a signal that is not an AbortSignal (the controller itself): reported, and nothing keeps polling', async () => {
    const api = client()
    let stop: unknown
    expect(() => { stop = poll(api.getStats, {}, () => {}, { every: 1000, signal: new AbortController() as never }) }).not.toThrow()
    expect(stop).toBeTypeOf('function')
    await vi.advanceTimersByTimeAsync(5000)
    expect(mock.calls.length).toBeLessThanOrEqual(1) // the first request, if it was sent, was aborted
    expect(vi.getTimerCount()).toBe(0)
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it('a Pollable that resolves with something other than a Result: a middleware error, delivered, and polling goes on', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let calls = 0
    const bad = async () => { calls++; return undefined as unknown as Result<Stats> }
    const seen: Result<Stats>[] = []
    const stop = poll(bad, {}, r => seen.push(r), { every: 1000 })
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(seen.map(r => r.error?.kind)).toEqual(['middleware', 'middleware'])
    expect(calls).toBe(2)
    stop()
  })

  it('a hand-written 429 or 503 Result whose response has no headers: polling goes on', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    for (const status of [429, 503]) {
      let calls = 0
      const endpoint = async () => {
        calls++
        return { data: null, error: { kind: 'http', status }, response: { status }, retry: () => endpoint() } as unknown as Result<Stats>
      }
      const stop = poll(endpoint, {}, () => {}, { every: 1000 })
      await flush()
      await vi.advanceTimersByTimeAsync(1000)
      expect(calls, `status ${status}`).toBe(2)
      stop()
    }
  })

  it("retry() on the middleware error from a throwing Pollable never throws or rejects either", async () => {
    const seen: Result<Stats>[] = []
    const syncThrow = (() => { throw new Error('sync') }) as unknown as () => Promise<Result<Stats>>
    const rejects = async (): Promise<Result<Stats>> => { throw new Error('async') }
    for (const endpoint of [syncThrow, rejects]) {
      const stop = poll(endpoint, {}, r => seen.push(r), { every: 1000 })
      await flush()
      stop()
    }
    expect(seen.map(r => r.error?.kind)).toEqual(['middleware', 'middleware'])
    for (const result of seen) {
      let again: Promise<Result<Stats>> | undefined
      expect(() => { again = result.retry() }).not.toThrow()
      await expect(again).resolves.toMatchObject({ error: { kind: 'middleware' } })
    }
  })

  it("stop() doesn't throw for a signal-like object without removeEventListener, and ends the poll", async () => {
    const api = client()
    const signal = { aborted: false, addEventListener() {} } as unknown as AbortSignal
    const stop = poll(api.getStats, {}, () => {}, { every: 1000, signal })
    await flush()
    expect(() => stop()).not.toThrow()
    await vi.advanceTimersByTimeAsync(5000)
    expect(mock.calls).toHaveLength(1)
  })

  it('a document without addEventListener or removeEventListener (a partial shim) still polls, and stop() ends it', async () => {
    for (const doc of [{ visibilityState: 'visible' }, { visibilityState: 'visible', addEventListener() {} }]) {
      vi.stubGlobal('document', doc)
      const api = client()
      const stop = poll(api.getStats, {}, () => {}, { every: 1000 })
      await flush()
      await vi.advanceTimersByTimeAsync(1000)
      expect(mock.calls, Object.keys(doc).join()).toHaveLength(2)
      expect(() => stop()).not.toThrow()
      await vi.advanceTimersByTimeAsync(5000)
      expect(mock.calls).toHaveLength(2)
      expect(vi.getTimerCount()).toBe(0)
      mock.restore()
    }
  })
})

describe('poll: what the docs promise', () => {
  it('equal headers objects, and an equal timeout, share one request per tick', async () => {
    shareable()
    const api = client()
    const stops = [
      poll(api.getStats, {}, () => {}, { every: 1000, headers: { 'x-tenant': 'a' } }),
      poll(api.getStats, {}, () => {}, { every: 1000, headers: { 'x-tenant': 'a' } }),
    ]
    await flush()
    expect(mock.calls).toHaveLength(1)
    stops.push(
      poll(api.getStats, {}, () => {}, { every: 1000, timeout: 5000 }),
      poll(api.getStats, {}, () => {}, { every: 1000, timeout: 5000 }),
    )
    await flush()
    expect(mock.calls).toHaveLength(2)
    stops.forEach(stop => stop())
  })

  it('skipMiddleware, or a Headers instance, gets a shared poll of its own', async () => {
    shareable()
    const api = client()
    const skip = (_: unknown, next: () => Promise<Result<unknown>>) => next()
    const stops = [
      poll(api.getStats, {}, () => {}, { every: 1000, skipMiddleware: [skip] }),
      poll(api.getStats, {}, () => {}, { every: 1000, skipMiddleware: [skip] }),
    ]
    await flush()
    expect(mock.calls).toHaveLength(2)
    stops.push(
      poll(api.getStats, {}, () => {}, { every: 1000, headers: new Headers({ 'x-tenant': 'a' }) }),
      poll(api.getStats, {}, () => {}, { every: 1000, headers: new Headers({ 'x-tenant': 'a' }) }),
    )
    await flush()
    expect(mock.calls).toHaveLength(4)
    stops.forEach(stop => stop())
  })

  it("URLSearchParams, FormData, Blob and ArrayBuffer params can't be compared: each caller gets its own poll", async () => {
    shareable()
    mock = mockFetch({ 'POST /upload': () => jsonResponse({ ok: true }) })
    mock.install()
    const upload = defineRequest<{ ok: boolean }, URLSearchParams | FormData | Blob | ArrayBuffer>()({ method: 'POST', path: '/upload' })
    const api = createApi({ baseUrl: 'https://api.test', requests: { upload } })
    const form = new FormData()
    form.set('x', '1')
    const stops = [
      // Equal but separate, then the very same object twice: neither shares.
      poll(api.upload, new URLSearchParams({ x: '1' }), () => {}, { every: 1000 }),
      poll(api.upload, new URLSearchParams({ x: '1' }), () => {}, { every: 1000 }),
      ...[form, new Blob(['x']), new ArrayBuffer(2)].flatMap(body => [
        poll(api.upload, body, () => {}, { every: 1000 }),
        poll(api.upload, body, () => {}, { every: 1000 }),
      ]),
    ]
    await flush()
    expect(mock.calls).toHaveLength(8)
    stops.forEach(stop => stop())
  })

  it("a caller's signal isn't passed to the requests: aborting it leaves a shared request running", async () => {
    shareable()
    // A hand-written Pollable sees exactly the options each request gets.
    const controller = new AbortController()
    const passed: Array<AbortSignal | undefined> = []
    const endpoint = async (_: object, options?: CallOptions) => { passed.push(options?.signal); return successResult({ n: 1 }) }
    const own = poll(endpoint, {}, () => {}, { every: 1000, signal: controller.signal })
    await flush()
    expect(passed[0]).toBeInstanceOf(AbortSignal)
    expect(passed[0]).not.toBe(controller.signal)
    own()

    const signals: AbortSignal[] = []
    const api = client({ 'GET /stats': ({ request }) => { signals.push(request.signal); return new Promise(r => setTimeout(() => r(jsonResponse({ n: 1 })), 3000)) } })
    const a = new AbortController()
    const b: Result<Stats>[] = []
    poll(api.getStats, {}, () => {}, { every: 1000, signal: a.signal })
    const stopB = poll(api.getStats, {}, r => b.push(r), { every: 1000 })
    await vi.advanceTimersByTimeAsync(100)
    a.abort()
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(2900)
    expect(ns(b)).toEqual([1])
    stopB()
  })

  it('per-request headers and timeout go with every request', async () => {
    const api = client()
    const stop = poll(api.getStats, {}, () => {}, { every: 1000, headers: { 'x-tenant': 'a' } })
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(mock.calls.map(c => c.headers.get('x-tenant'))).toEqual(['a', 'a'])
    stop(); mock.restore()

    // Fake timers drive the per-request deadline only through the setTimeout fallback.
    vi.stubGlobal('AbortSignal', Object.assign(function () {}, AbortSignal, { timeout: undefined }))
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const hangs = client({ 'GET /stats': ({ request }) => new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason))) })
    const kinds: string[] = []
    const stop2 = poll(hangs.getStats, {}, r => kinds.push(r.error?.kind ?? 'ok'), { every: 1000, timeout: 50 })
    await vi.advanceTimersByTimeAsync(50)
    await vi.advanceTimersByTimeAsync(1100)
    expect(kinds).toEqual(['timeout', 'timeout'])
    stop2()
  })
})
