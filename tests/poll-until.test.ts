import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApi, createGraphQL, defineRequest, gql, Operation, poll, pollUntil, withHeaders } from '../src/index.js'
import { mockFetch, jsonResponse, successResult } from '../src/testing.js'
import type { Middleware, Result } from '../src/index.js'

type Job = { id: string; status: 'queued' | 'running' | 'done' }
let mock: ReturnType<typeof mockFetch>

/** Each request the routes received, so a test can check its signal (RecordedCall has none). */
let requests: Request[] = []

/** GET /jobs/:id answers with these statuses (numbers are HTTP errors), then repeats the last one. */
function jobs(answers: Array<Job['status'] | number>, delay = 0) {
  let i = 0
  requests = []
  mock = mockFetch({ 'GET /jobs/:id': ({ params, request }) => {
    requests.push(request)
    const a = answers[Math.min(i++, answers.length - 1)]
    const response = typeof a === 'number' ? jsonResponse({ message: 'no' }, { status: a }) : jsonResponse({ id: params.id, status: a })
    return delay ? new Promise(r => setTimeout(() => r(response), delay)) : response
  } })
  mock.install()
  const getJob = defineRequest<Job>()({ method: 'GET', path: '/jobs/:id' })
  return createApi({ baseUrl: 'https://api.test', requests: { getJob } })
}
/** Whether `p` has settled by now: a hang fails an assertion instead of timing out. */
const settled = async (p: Promise<unknown>): Promise<boolean> => {
  let done = false
  void p.then(() => { done = true })
  await Promise.resolve()
  return done
}
const isDone = (r: { data: Job }) => r.data.status === 'done'
/** Polls are shared only where there is a `window` (browsers, React Native). Node has none, so a test of sharing stubs one. */
const shareable = () => vi.stubGlobal('window', globalThis)
/** A browser: errors go to `reportError` only where there is a `document`. */
const inBrowser = () => vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { mock?.restore(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('pollUntil', () => {
  it('resolves with the first success where until is true, and stops polling', async () => {
    const api = jobs(['queued', 'running', 'done'])
    const done = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone })
    await vi.advanceTimersByTimeAsync(2000)
    const { data, error } = await done
    expect(error).toBeNull()
    expect(data).toEqual({ id: '7', status: 'done' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mock.calls).toHaveLength(3)
  })

  it('a late joiner whose until is already true resolves without a new request', async () => {
    shareable()
    const api = jobs(['done'])
    const stop = poll(api.getJob, { id: '7' }, () => {}, { every: 1000 })
    await vi.advanceTimersByTimeAsync(0)
    const r = await pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone })
    expect(r.error).toBeNull()
    expect(mock.calls).toHaveLength(1)
    stop()
  })

  it('stops at an error waiting cannot fix (404), while a poll() on the same thing keeps going', async () => {
    shareable()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const api = jobs([404])
    const seen: Result<Job>[] = []
    const stop = poll(api.getJob, { id: '7' }, r => seen.push(r), { every: 1000 })
    const pending = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone })
    await vi.advanceTimersByTimeAsync(100)
    expect(await settled(pending)).toBe(true)
    const r = await pending
    expect(r.error?.status).toBe(404)
    await vi.advanceTimersByTimeAsync(2000)
    expect(seen.length).toBeGreaterThanOrEqual(3)
    stop()
  })

  it.each([500, 503, 408, 429])('keeps polling through %i', async status => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const api = jobs([status, 'done'])
    const r = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone })
    await vi.advanceTimersByTimeAsync(1000)
    expect((await r).error).toBeNull()
  })

  it('keeps polling through a network error', async () => {
    let i = 0
    mock = mockFetch({ 'GET /jobs/:id': () => (i++ === 0 ? Promise.reject(new TypeError('offline')) : jsonResponse({ id: '7', status: 'done' })) })
    mock.install()
    const api = createApi({ baseUrl: 'https://api.test', requests: { getJob: defineRequest<Job>()({ method: 'GET', path: '/jobs/:id' }) } })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const r = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone })
    await vi.advanceTimersByTimeAsync(1000)
    expect((await r).error).toBeNull()
  })

  it('stops at a parse error', async () => {
    mock = mockFetch({ 'GET /jobs/:id': () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }) })
    mock.install()
    const api = createApi({ baseUrl: 'https://api.test', requests: { getJob: defineRequest<Job>()({ method: 'GET', path: '/jobs/:id' }) } })
    const pending = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone })
    await vi.advanceTimersByTimeAsync(100)
    expect(await settled(pending)).toBe(true)
    const r = await pending
    expect(r.error?.kind).toBe('parse')
    expect(mock.calls).toHaveLength(1)
  })

  it('giveUpAfter resolves with a timeout error that names the last attempt', async () => {
    const api = jobs(['queued'])
    const r = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone, giveUpAfter: 2500 })
    await vi.advanceTimersByTimeAsync(2500)
    const { error, data, response } = await r
    expect(data).toBeNull()
    expect(response).toBeNull()
    expect(error).toMatchObject({ kind: 'timeout', status: 0, request: { method: 'GET', url: 'https://api.test/jobs/7', params: { id: '7' } } })
    expect((error!.body as Error).name).toBe('TimeoutError')
  })

  it('giveUpAfter during a request in flight resolves timeout once and aborts the request', async () => {
    const api = jobs(['done'], 5000)
    const r = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone, giveUpAfter: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    expect((await r).error?.kind).toBe('timeout')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mock.calls).toHaveLength(1) // the only caller left: the poll stopped
    expect(requests[0].signal.aborted).toBe(true)
  })

  it('a non-finite or non-positive giveUpAfter means no limit', async () => {
    for (const giveUpAfter of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const api = jobs(['queued', 'queued', 'queued', 'done'])
      const r = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone, giveUpAfter })
      await vi.advanceTimersByTimeAsync(3000)
      expect((await r).error, `giveUpAfter: ${giveUpAfter}`).toBeNull()
      mock.restore()
    }
  })

  it("its signal aborting resolves with kind 'abort'; an already-aborted signal sends nothing", async () => {
    const api = jobs(['queued'])
    const controller = new AbortController()
    const r = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone, signal: controller.signal })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    expect((await r).error?.kind).toBe('abort')
    mock.restore()
    const api2 = jobs(['queued'])
    const r2 = await pollUntil(api2.getJob, { id: '7' }, { every: 1000, until: isDone, signal: AbortSignal.abort() })
    expect(r2.error?.kind).toBe('abort')
    expect(mock.calls).toHaveLength(0)
  })

  it('until throwing counts as not done and is reported', async () => {
    inBrowser()
    const reportError = vi.fn()
    vi.stubGlobal('reportError', reportError)
    const api = jobs(['queued', 'done'])
    let first = true
    const r = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: res => { if (first) { first = false; throw new Error('boom') } return isDone(res) } })
    await vi.advanceTimersByTimeAsync(1000)
    expect((await r).error).toBeNull()
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('joining a slower poll with a shorter every takes effect at once: it resolves, not times out', async () => {
    shareable()
    const api = jobs(['queued', 'done'])
    const stop = poll(api.getJob, { id: '7' }, () => {}, { every: 3000 })
    await vi.advanceTimersByTimeAsync(20) // answered at 0 ms: the next request would wait until 3000 ms
    const pending = pollUntil(api.getJob, { id: '7' }, { every: 50, until: isDone, giveUpAfter: 1000 })
    await vi.advanceTimersByTimeAsync(29)
    expect(mock.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1) // 50 ms after the last answer
    expect(mock.calls).toHaveLength(2)
    expect(await settled(pending)).toBe(true)
    expect((await pending).error).toBeNull()
    stop()
  })

  it("a shorter-every joiner that leaves at once doesn't bring the next request forward", async () => {
    shareable()
    const api = jobs(['done'])
    const stop = poll(api.getJob, { id: '7' }, () => {}, { every: 3000 })
    await vi.advanceTimersByTimeAsync(20) // answered at 0 ms: the next request is due at 3000 ms
    // A pollUntil that the last answer already satisfies, and a poll stopped at once.
    expect((await pollUntil(api.getJob, { id: '7' }, { every: 50, until: isDone })).error).toBeNull()
    poll(api.getJob, { id: '7' }, () => {}, { every: 50 })()
    await vi.advanceTimersByTimeAsync(2979) // 2999 ms
    expect(mock.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1) // 3000 ms
    expect(mock.calls).toHaveLength(2)
    stop()
  })

  it('until throwing, where there is no document, is logged as until', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = jobs(['done'])
    const r = pollUntil(api.getJob, { id: '7' }, { every: 1000, giveUpAfter: 500, until: () => { throw new Error('boom') } })
    await vi.advanceTimersByTimeAsync(500)
    expect((await r).error?.kind).toBe('timeout')
    expect(log).toHaveBeenCalledWith('[liaise] poll: until failed:', expect.objectContaining({ message: 'boom' }))
  })

  it('two pollUntil calls on the same job share requests', async () => {
    shareable()
    const api = jobs(['queued', 'done'])
    const a = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone })
    const b = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone })
    await vi.advanceTimersByTimeAsync(1000)
    expect((await a).error).toBeNull()
    expect((await b).error).toBeNull()
    expect(mock.calls).toHaveLength(2)
  })

  it('two pollUntil calls through copies rebuilt with the same headers share requests', async () => {
    shareable()
    const api = jobs(['queued', 'done'])
    const a = pollUntil(withHeaders(api, { cookie: 's=a' }).getJob, { id: '7' }, { every: 1000, until: isDone })
    const b = pollUntil(withHeaders(api, { cookie: 's=a' }).getJob, { id: '7' }, { every: 1000, until: isDone })
    await vi.advanceTimersByTimeAsync(1000)
    expect((await a).error).toBeNull()
    expect((await b).error).toBeNull()
    expect(mock.calls).toHaveLength(2)
    expect(mock.calls.map(c => c.headers.get('cookie'))).toEqual(['s=a', 's=a'])
  })

  it("its own timeout result's retry() runs pollUntil again", async () => {
    const api = jobs(['queued'])
    const r = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone, giveUpAfter: 500 })
    await vi.advanceTimersByTimeAsync(500)
    const first = await r
    const again = first.retry()
    await vi.advanceTimersByTimeAsync(500)
    expect((await again).error?.kind).toBe('timeout')
    expect(mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(mock.calls[1].url).toMatch(/\/jobs\/7$/)
  })
})

describe('pollUntil: how it ends, and what it leaves behind', () => {
  it('a Pollable that throws synchronously resolves middleware and leaves no timer or poll running', async () => {
    vi.stubGlobal('reportError', vi.fn())
    vi.spyOn(console, 'error').mockImplementation(() => {}) // reportError is used only in a browser
    let calls = 0
    const syncThrow = ((): Promise<Result<Job>> => { calls++; throw new Error('sync') }) as unknown as (p: { id: string }) => Promise<Result<Job>>
    const r = pollUntil(syncThrow, { id: '7' }, { every: 1000, until: isDone, giveUpAfter: 600_000, signal: new AbortController().signal })
    await vi.advanceTimersByTimeAsync(600_000)
    expect((await r).error?.kind).toBe('middleware')
    expect(calls).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a giveUpAfter above the longest timer means no limit', async () => {
    const api = jobs(['queued'])
    const r = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone, giveUpAfter: Number.MAX_SAFE_INTEGER })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await settled(r)).toBe(false)
  })

  it('stops when a per-call middleware throws (middleware error)', async () => {
    const api = jobs(['done'])
    const pending = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone, middleware: [() => { throw new Error('x') }] })
    await vi.advanceTimersByTimeAsync(100)
    expect(await settled(pending)).toBe(true)
    expect((await pending).error?.kind).toBe('middleware')
    expect(mock.calls).toHaveLength(0)
  })

  it("stops when the endpoint's own dedupe aborts the request (abort error)", async () => {
    mock = mockFetch({ 'GET /jobs/:id': ({ params }) => new Promise(r => setTimeout(() => r(jsonResponse({ id: params.id, status: 'queued' })), 5000)) })
    mock.install()
    const getJob = defineRequest<Job>()({ method: 'GET', path: '/jobs/:id', dedupe: true })
    const api = createApi({ baseUrl: 'https://api.test', requests: { getJob } })
    const pending = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone })
    await vi.advanceTimersByTimeAsync(0)
    void api.getJob({ id: '7' })
    await vi.advanceTimersByTimeAsync(100)
    expect(await settled(pending)).toBe(true)
    expect((await pending).error?.kind).toBe('abort')
  })

  it("two polls of a dedupe: true endpoint with different params cancel each other, so pollUntil can end with 'abort'", async () => {
    mock = mockFetch({ 'GET /jobs/:id': ({ params }) => new Promise(r => setTimeout(() => r(jsonResponse({ id: params.id, status: 'queued' })), 5000)) })
    mock.install()
    const getJob = defineRequest<Job>()({ method: 'GET', path: '/jobs/:id', dedupe: true })
    const api = createApi({ baseUrl: 'https://api.test', requests: { getJob } })
    const seven = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone })
    const stop = poll(api.getJob, { id: '8' }, () => {}, { every: 1000 })
    await vi.advanceTimersByTimeAsync(100)
    expect(await settled(seven)).toBe(true)
    expect((await seven).error?.kind).toBe('abort')
    stop()
  })

  it("keeps polling through a single request's timeout", async () => {
    vi.stubGlobal('AbortSignal', Object.assign(function () {}, AbortSignal, { timeout: undefined }))
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let i = 0
    mock = mockFetch({ 'GET /jobs/:id': ({ params, request }) => {
      if (i++ > 0) return jsonResponse({ id: params.id, status: 'done' })
      return new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason)))
    } })
    mock.install()
    const getJob = defineRequest<Job>()({ method: 'GET', path: '/jobs/:id', timeout: 50 })
    const api = createApi({ baseUrl: 'https://api.test', requests: { getJob } })
    const r = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone })
    await vi.advanceTimersByTimeAsync(50)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await settled(r)).toBe(true)
    expect((await r).error).toBeNull()
    expect(i).toBe(2)
  })

  it('asking once (every: 0) resolves with the first Result, even when until is not met', async () => {
    const api = jobs(['queued'])
    const pending = pollUntil(api.getJob, { id: '7' }, { every: 0, until: isDone })
    await vi.advanceTimersByTimeAsync(100)
    expect(await settled(pending)).toBe(true)
    const r = await pending
    expect(r.error).toBeNull()
    expect(r.data?.status).toBe('queued')
    expect(mock.calls).toHaveLength(1)
  })

  it('a GraphQL error response (errors on a 200) ends pollUntil', async () => {
    mock = mockFetch({ 'POST /graphql': () => jsonResponse({ data: null, errors: [{ message: 'nope' }] }) })
    mock.install()
    const getStats = new Operation<Record<string, never>, { n: number }>({ operation: gql`query GetStats { n }` })
    const graph = createGraphQL({ endpoint: 'https://api.test/graphql', operations: { getStats } })
    const pending = pollUntil(graph.getStats, {}, { every: 1000, until: () => false })
    await vi.advanceTimersByTimeAsync(100)
    expect(await settled(pending)).toBe(true)
    expect((await pending).error?.kind).toBe('http')
    expect(mock.calls).toHaveLength(1)
  })

  it('cleans up after a success: no timer, and the signal listener is removed', async () => {
    const api = jobs(['done'])
    const controller = new AbortController()
    const removed = vi.spyOn(controller.signal, 'removeEventListener')
    const r = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone, giveUpAfter: 60_000, signal: controller.signal })
    await vi.advanceTimersByTimeAsync(100)
    expect((await r).error).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('a Pollable that resolves with something other than a Result resolves middleware, with no unhandled rejection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = (async () => undefined) as unknown as (p: { id: string }) => Promise<Result<Job>>
    const pending = pollUntil(bad, { id: '7' }, { every: 1000, until: isDone, giveUpAfter: 5000 })
    await vi.advanceTimersByTimeAsync(100)
    expect(await settled(pending)).toBe(true)
    expect((await pending).error?.kind).toBe('middleware')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a signal-like object without removeEventListener still resolves, and stops the poll', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = jobs(['queued', 'done'])
    const signal = { aborted: false, addEventListener() {} } as unknown as AbortSignal
    const pending = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone, signal })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await settled(pending)).toBe(true)
    expect((await pending).error).toBeNull()
    await vi.advanceTimersByTimeAsync(5000)
    expect(mock.calls).toHaveLength(2)

    // Ended by giveUpAfter: its timer must not throw (uncaught there, it would crash Node).
    mock.restore()
    const stuck = jobs(['queued'])
    const timedOut = pollUntil(stuck.getJob, { id: '7' }, { every: 50, until: isDone, giveUpAfter: 120, signal })
    let thrown: unknown
    await vi.advanceTimersByTimeAsync(120).catch((error: unknown) => { thrown = error })
    expect(thrown).toBeUndefined()
    expect(await settled(timedOut)).toBe(true)
    expect((await timedOut).error?.kind).toBe('timeout')
  })

  it('params that are undefined are passed on as they are', async () => {
    const passed: unknown[] = []
    const endpoint = async (params: unknown) => { passed.push(params); return successResult<Job>({ id: '7', status: 'done' }) }
    const r = await pollUntil(endpoint, undefined as never, { every: 1000, until: isDone })
    expect(r.error).toBeNull()
    expect(passed).toEqual([undefined])
  })

  it('never rejects, even for options that are not an object', async () => {
    vi.stubGlobal('reportError', vi.fn())
    vi.spyOn(console, 'error').mockImplementation(() => {}) // reportError is used only in a browser
    const api = jobs(['done'])
    await expect(pollUntil(api.getJob, { id: '7' }, undefined as never)).resolves.toMatchObject({ error: { kind: 'middleware' } })
  })
})

describe('pollUntil: what the docs promise', () => {
  /** A stub document whose visibility the test controls. */
  function tab() {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as 'visible' | 'hidden' })
    vi.stubGlobal('document', doc)
    return {
      hide() { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')) },
      show() { doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')) },
    }
  }

  it('giveUpAfter keeps counting in a hidden tab: timeout at giveUpAfter, nothing sent', async () => {
    tab().hide()
    const api = jobs(['done'])
    const pending = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone, giveUpAfter: 5000 })
    await vi.advanceTimersByTimeAsync(4999)
    expect(await settled(pending)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await settled(pending)).toBe(true)
    expect((await pending).error?.kind).toBe('timeout')
    expect(mock.calls).toHaveLength(0)
  })

  it('keeps polling through a 304, and resolves on a later answer', async () => {
    shareable()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let i = 0
    mock = mockFetch({ 'GET /jobs/:id': ({ params }) => (i++ === 0 ? new Response(null, { status: 304 }) : jsonResponse({ id: params.id, status: 'done' })) })
    mock.install()
    const api = createApi({ baseUrl: 'https://api.test', requests: { getJob: defineRequest<Job>()({ method: 'GET', path: '/jobs/:id' }) } })
    const statuses: number[] = []
    const stop = poll(api.getJob, { id: '7' }, r => statuses.push(r.error ? r.error.status : 200), { every: 1000 })
    const pending = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone })
    await vi.advanceTimersByTimeAsync(100)
    expect(statuses).toEqual([304]) // the first answer was a 304 error…
    expect(await settled(pending)).toBe(false) // …and it didn't end pollUntil
    await vi.advanceTimersByTimeAsync(1000)
    expect(await settled(pending)).toBe(true)
    expect((await pending).error).toBeNull()
    expect(mock.calls).toHaveLength(2)
    stop()
  })

  it("the abort result's error.body is the signal's reason", async () => {
    const api = jobs(['queued'])
    const reason = new Error('user left')
    const controller = new AbortController()
    const pending = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone, signal: controller.signal })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(reason)
    expect((await pending).error?.body).toBe(reason)
    const early = await pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone, signal: AbortSignal.abort(reason) })
    expect(early.error?.body).toBe(reason)
  })

  it("names no request when none was sent: method and url are '', params as given", async () => {
    const api = jobs(['done'])
    const params = { id: '7' }
    const aborted = await pollUntil(api.getJob, params, { every: 1000, until: isDone, signal: AbortSignal.abort() })
    expect(aborted.error?.request).toEqual({ method: '', url: '', params })
    tab().hide()
    const pending = pollUntil(api.getJob, params, { every: 1000, until: isDone, giveUpAfter: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    expect((await pending).error?.request).toEqual({ method: '', url: '', params })
    expect(mock.calls).toHaveLength(0)
  })

  it('error.request names the most recent request that was sent, not an attempt a middleware answered', async () => {
    const api = jobs(['queued'])
    // Marks each attempt's URL, sends only the first, and answers the rest with that first Result.
    let attempt = 0
    let first: Result<unknown> | undefined
    const answerAfterFirst: Middleware = async (ctx, next) => {
      attempt++
      ctx.request.url = `${ctx.request.url}?attempt=${attempt}`
      return first ?? (first = await next())
    }
    const pending = pollUntil(api.getJob, { id: '7' }, { every: 1000, until: isDone, giveUpAfter: 3500, middleware: [answerAfterFirst] })
    await vi.advanceTimersByTimeAsync(3500)
    const { error } = await pending
    expect(attempt).toBe(4)
    expect(mock.calls).toHaveLength(1)
    expect(error?.request).toMatchObject({ method: 'GET', url: 'https://api.test/jobs/7?attempt=1' })

    // A middleware that never calls next(): nothing is sent, so nothing is named.
    const neverSends: Middleware = async () => successResult({ id: '8', status: 'queued' })
    const r = pollUntil(api.getJob, { id: '8' }, { every: 1000, until: isDone, giveUpAfter: 1500, middleware: [neverSends] })
    await vi.advanceTimersByTimeAsync(1500)
    expect((await r).error?.request).toMatchObject({ method: '', url: '' })
    expect(mock.calls).toHaveLength(1)
  })
})
