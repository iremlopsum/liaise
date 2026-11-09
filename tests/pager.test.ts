import { describe, it, expect, vi, afterEach } from 'vitest'
import { createPager } from '../src/pager.js'
import type { NumberedPagerOptions, PagerState } from '../src/pager.js'
import { ApiError, createNetworkErrorResult } from '../src/result.js'
import { errorResult, successResult } from '../src/testing.js'
import type { CallOptions, Result } from '../src/types.js'

type P = { offset: number; limit: number; q?: string }
type D = { items: number[]; totalCount: number }

interface Call {
  params: P
  options: CallOptions | undefined
  signal: AbortSignal | undefined
  resolve: (result: Result<D>) => void
}

/** The endpoint's own abort Result, as a liaise endpoint resolves on its signal. */
function abortResult(reason: unknown, params: P): Result<D> {
  const error = new ApiError({ kind: 'abort', status: 0, statusText: '', body: reason, headers: new Headers(), request: { method: 'GET', url: '/items', params } })
  const result: Result<D> = createNetworkErrorResult<D>(error, async () => result)
  return result
}

const pageOf = (p: P) => p.offset / p.limit + 1

/**
 * A controllable endpoint: every call waits until the test releases it. With
 * `honour` (the default) it resolves with an abort Result when its signal aborts,
 * as every liaise endpoint does; without, it ignores the signal (Review Focus 2).
 */
function fake({ honour = true } = {}) {
  const calls: Call[] = []
  const endpoint = (params: P, options?: CallOptions): Promise<Result<D>> =>
    new Promise(resolve => {
      const signal = options?.signal
      calls.push({ params, options, signal, resolve })
      if (honour && signal) {
        const abort = () => resolve(abortResult(signal.reason, params))
        if (signal.aborted) abort()
        else signal.addEventListener('abort', abort, { once: true })
      }
    })
  /** Answers call `i` with its page: data `{ items: [page], totalCount }`. */
  const sent = (i: number): Call => {
    expect(calls[i], `request ${i} was sent`).toBeDefined()
    return calls[i]!
  }
  const release = (i: number, totalCount = 230) => {
    const p = sent(i).params
    calls[i]!.resolve(successResult<D>({ items: [pageOf(p)], totalCount }))
  }
  const fail = (i: number, status = 500) => sent(i).resolve(errorResult<D>(status))
  return { endpoint, calls, release, fail }
}

const base: P = { offset: 0, limit: 25 }
const numbered: NumberedPagerOptions<P, D> = {
  toParams: (n, p) => ({ ...p, offset: (n - 1) * p.limit }),
  pageCount: r => Math.ceil(r.data.totalCount / 25),
}
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))
const shown = (state: PagerState<P, D>) => state.data?.items[0] ?? null

afterEach(() => { vi.restoreAllMocks() })

describe('createPager: numbered pages', () => {
  it('sends nothing until load()', () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, numbered)
    expect(f.calls).toHaveLength(0)
    expect(pager.state.page).toBeNull()
    expect(pager.state.loading).toBe(false)
  })

  it('load() opens start (default 1)', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, numbered)
    const loading = pager.load()
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]!.params.offset).toBe(0)
    expect(pager.state).toMatchObject({ loading: true, target: 1, data: null })
    f.release(0, 230)
    const result = await loading
    expect(result?.data?.items).toEqual([1])
    expect(pager.state).toMatchObject({ loading: false, target: null, page: 1, pageCount: 10, hasNext: true, hasPrev: false, params: { offset: 0, limit: 25 } })

    const g = fake()
    const at7 = createPager(g.endpoint, base, { ...numbered, start: 7 })
    void at7.load()
    expect(g.calls[0]!.params.offset).toBe(150)
  })

  it("keeps the previous page's data while the next loads", async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, numbered)
    const first = pager.load(); f.release(0); await first
    void pager.goTo(2)
    expect(pager.state).toMatchObject({ page: 1, target: 2, loading: true })
    expect(shown(pager.state)).toBe(1)
  })

  for (const honour of [true, false]) {
    it(`latest move wins: 3 → 5 → 4 (${honour ? 'endpoint honours its signal' : 'endpoint ignores its signal'})`, async () => {
      const f = fake({ honour })
      const pager = createPager(f.endpoint, base, numbered)
      const first = pager.load(); f.release(0); await first
      const seen: (number | null)[] = []
      pager.subscribe(() => seen.push(shown(pager.state)))

      const to3 = pager.goTo(3)
      const to5 = pager.goTo(5)
      const to4 = pager.goTo(4)
      expect(f.calls.map(c => pageOf(c.params))).toEqual([1, 3, 5, 4])
      expect(f.calls[1]!.signal!.aborted).toBe(true)
      expect(f.calls[2]!.signal!.aborted).toBe(true)
      expect(f.calls[3]!.signal!.aborted).toBe(false)
      expect(f.calls[1]!.signal!.reason).toMatchObject({ name: 'AbortError', message: 'Superseded by a newer move' })

      f.release(3)
      await to4
      // The superseded ones answer late, after page 4.
      f.release(1)
      f.release(2)
      const [r3, r5] = await Promise.all([to3, to5])
      // Always an abort, even from an endpoint that ignored its signal and answered.
      for (const r of [r3, r5]) {
        expect(r?.error?.kind).toBe('abort')
        expect(r?.error?.body).toMatchObject({ name: 'AbortError', message: 'Superseded by a newer move' })
      }
      await flush()

      expect(pager.state.page).toBe(4)
      expect(shown(pager.state)).toBe(4)
      expect(pager.state.error).toBeNull()
      expect(seen).not.toContain(3)
      expect(seen).not.toContain(5)
    })

    it(`setParams while loading: the old filter's reply never lands (${honour ? 'honours' : 'ignores'} its signal)`, async () => {
      const f = fake({ honour })
      const pager = createPager(f.endpoint, base, numbered)
      const first = pager.load(); f.release(0); await first

      const old = pager.goTo(3)
      const filtered = pager.setParams({ ...base, q: 'x' })
      expect(f.calls[1]!.signal!.aborted).toBe(true)
      expect(f.calls[2]!.params).toEqual({ offset: 0, limit: 25, q: 'x' })
      expect(pager.state.target).toBe(1)

      f.release(2, 40)
      await filtered
      f.fail(1, 500) // the old filter's page 3, answering late, as a 500
      await old
      await flush()

      expect(pager.state.error).toBeNull()
      expect(pager.state.page).toBe(1)
      expect(pager.state.params).toEqual({ offset: 0, limit: 25, q: 'x' })
      expect(pager.state.pageCount).toBe(2)
      expect(pager.state.loading).toBe(false)
    })
  }

  it('two quick next() clicks from 3 land on 5', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, { ...numbered, start: 3 })
    const first = pager.load(); f.release(0); await first
    void pager.next()
    const second = pager.next()
    expect(pageOf(f.calls[2]!.params)).toBe(5)
    expect(pager.state.target).toBe(5)
    f.release(2)
    await second
    expect(pager.state.page).toBe(5)
  })

  it('goTo out of range resolves null and sends nothing', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, numbered)
    const first = pager.load(); f.release(0, 250); await first
    expect(pager.state.pageCount).toBe(10)
    // Counted before awaiting: a move that sent would never settle here.
    const nowhere = [pager.goTo(0), pager.goTo(2.5), pager.goTo(11), pager.prev()]
    expect(f.calls).toHaveLength(1)
    expect(await Promise.all(nowhere)).toEqual([null, null, null, null])

    const last = pager.goTo(10); f.release(1, 250); await last
    expect(pager.state.hasNext).toBe(false)
    const past = pager.next()
    expect(f.calls).toHaveLength(2)
    expect(await past).toBeNull()
  })

  it('without pageCount, hasNext stays true and pageCount is null', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, { toParams: numbered.toParams })
    const first = pager.load(); f.release(0); await first
    expect(pager.state.pageCount).toBeNull()
    expect(pager.state.hasNext).toBe(true)
    const far = pager.goTo(500); f.release(1); await far
    expect(pager.state).toMatchObject({ page: 500, hasNext: true, pageCount: null })
  })

  it('an error keeps the shown page', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, numbered)
    const first = pager.load(); f.release(0); await first
    const to2 = pager.goTo(2); f.fail(1, 500)
    const result = await to2
    expect(result?.error?.status).toBe(500)
    expect(pager.state.error?.status).toBe(500)
    expect(pager.state).toMatchObject({ page: 1, loading: false, target: null })
    expect(shown(pager.state)).toBe(1)

    const again = pager.goTo(2); f.release(2); await again
    expect(pager.state.error).toBeNull()
    expect(pager.state.page).toBe(2)
  })

  it('cached pages come back without a request', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, numbered)
    const first = pager.load(); f.release(0)
    const r1 = await first
    const to2 = pager.goTo(2); f.release(1); await to2
    const back = pager.goTo(1)
    expect(pager.state.page).toBe(1)
    expect(pager.state.loading).toBe(false)
    expect(shown(pager.state)).toBe(1)
    expect(await back).toBe(r1)
    expect(f.calls).toHaveLength(2)

    // refresh() refetches the current page even though it's cached, and replaces the entry.
    const refreshed = pager.refresh()
    expect(f.calls).toHaveLength(3)
    expect(pager.state).toMatchObject({ loading: true, target: 1 })
    f.release(2)
    const r1b = await refreshed
    expect(r1b).not.toBe(r1)
    const to2b = pager.goTo(2); await to2b
    expect(await pager.goTo(1)).toBe(r1b)
    expect(f.calls).toHaveLength(3)

    const g = fake()
    const uncached = createPager(g.endpoint, base, { ...numbered, cache: false })
    const a = uncached.load(); g.release(0); await a
    const b = uncached.goTo(2); g.release(1); await b
    const c = uncached.goTo(1); g.release(2); await c
    expect(g.calls).toHaveLength(3)
  })

  it('setParams clears the cache', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, numbered)
    const a = pager.load(); f.release(0); await a
    const b = pager.goTo(2); f.release(1); await b
    const c = pager.setParams({ ...base, q: 'x' }); f.release(2); await c
    void pager.goTo(2)
    expect(f.calls).toHaveLength(4)
    expect(f.calls[3]!.params).toEqual({ offset: 25, limit: 25, q: 'x' })
  })

  it('state is the same object until something changes, and frozen', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, numbered)
    const idle = pager.state
    expect(Object.isFrozen(idle)).toBe(true)
    expect(pager.state).toBe(idle)
    const a = pager.load(); f.release(0); await a
    const loaded = pager.state
    expect(loaded).not.toBe(idle)
    expect(Object.isFrozen(loaded)).toBe(true)
    const listener = vi.fn()
    pager.subscribe(listener)
    const nowhere = pager.goTo(99)
    expect(f.calls).toHaveLength(1)
    await nowhere
    expect(pager.state).toBe(loaded)
    // A move that changes nothing (page 1, from the cache) keeps the object and notifies no one.
    await pager.goTo(1)
    expect(pager.state).toBe(loaded)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('createPager: subscribe', () => {
  it('listeners run once per change; unsubscribe stops them', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, numbered)
    const listener = vi.fn()
    const off = pager.subscribe(listener)
    const a = pager.load()
    expect(listener).toHaveBeenCalledTimes(1) // loading
    expect(listener).toHaveBeenCalledWith()
    f.release(0); await a
    expect(listener).toHaveBeenCalledTimes(2) // page 1
    off()
    const b = pager.goTo(2); f.release(1); await b
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('a listener that calls a move or unsubscribes during a notification', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, numbered)
    const first = pager.load(); f.release(0); await first

    const late = vi.fn()
    let acted = false
    const one = vi.fn(() => {
      if (acted) return
      acted = true
      offOne()
      void pager.goTo(2)
      pager.subscribe(late) // joins after this change began: not called for it
    })
    const two = vi.fn()
    const three = vi.fn()
    const offOne = pager.subscribe(one)
    pager.subscribe(two)
    pager.subscribe(three)

    let refreshing: Promise<Result<D> | null> | undefined
    expect(() => { refreshing = pager.refresh() }).not.toThrow()
    // Two changes: refresh's loading, then goTo(2)'s from inside the first listener.
    expect(one).toHaveBeenCalledTimes(1)
    expect(two).toHaveBeenCalledTimes(2)
    expect(three).toHaveBeenCalledTimes(2)
    expect(late).toHaveBeenCalledTimes(0)
    expect(pager.state.target).toBe(2)
    // refresh was superseded inside its own notification, so it never sent.
    expect(f.calls.map(c => pageOf(c.params))).toEqual([1, 2])
    expect((await refreshing)?.error?.kind).toBe('abort')
    f.release(1)
    await flush()
    expect(pager.state.page).toBe(2)
    expect(late).toHaveBeenCalledTimes(1)
  })

  it('a throwing listener is reported and the others still run', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = fake()
    const pager = createPager(f.endpoint, base, numbered)
    const after = vi.fn()
    pager.subscribe(() => { throw new Error('boom') })
    pager.subscribe(after)
    expect(() => pager.load()).not.toThrow()
    expect(after).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('[liaise] pager: a listener failed:', expect.objectContaining({ message: 'boom' }))
  })
})

describe('createPager: failures become Results', () => {
  it("a throwing toParams resolves kind 'middleware' with the thrown value as body", async () => {
    const f = fake()
    const thrown = new Error('bad page')
    const pager = createPager(f.endpoint, base, { toParams: () => { throw thrown } })
    const result = await pager.load()
    expect(result?.error?.kind).toBe('middleware')
    expect(result?.error?.body).toBe(thrown)
    const again = result!.retry() // asking again would change nothing: no request
    expect(f.calls).toHaveLength(0)
    expect(await again).toBe(result)
    expect(pager.state.error?.body).toBe(thrown)
    expect(pager.state.loading).toBe(false)
  })

  it("an endpoint that throws, rejects or returns a non-Result → kind 'middleware'", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const cause = new Error('down')
    const endpoints = [
      (): Promise<Result<D>> => { throw cause },
      (): Promise<Result<D>> => Promise.reject(cause),
      (): Promise<Result<D>> => Promise.resolve(undefined as unknown as Result<D>),
    ]
    for (const endpoint of endpoints) {
      const pager = createPager(endpoint, base, numbered)
      const loading = pager.load()
      await expect(loading).resolves.toMatchObject({ data: null, error: { kind: 'middleware' } })
      expect(pager.state.error?.kind).toBe('middleware')
      expect(pager.state.loading).toBe(false)
    }
  })

  it("options with neither toParams nor next → every move resolves kind 'middleware' with a TypeError", async () => {
    const f = fake()
    let pager: ReturnType<typeof createPager<P, D>> | undefined
    expect(() => { pager = createPager(f.endpoint, base, {} as NumberedPagerOptions<P, D>) }).not.toThrow()
    for (const move of [() => pager!.load(), () => pager!.goTo(1), () => pager!.next(), () => pager!.prev(), () => pager!.refresh(), () => pager!.setParams(base)]) {
      const result = await move()
      expect(result?.error?.kind).toBe('middleware')
      expect(result?.error?.body).toBeInstanceOf(TypeError)
      expect(String((result?.error?.body as Error).message)).toMatch(/toParams/)
    }
    expect(f.calls).toHaveLength(0)
  })

  it("the caller's signal stops the pager", async () => {
    const f = fake()
    const controller = new AbortController()
    const pager = createPager(f.endpoint, base, { ...numbered, signal: controller.signal })
    const first = pager.load(); f.release(0); await first
    const to2 = pager.goTo(2)
    const reason = new Error('left the page')
    controller.abort(reason)
    expect(f.calls[1]!.signal!.aborted).toBe(true)
    const stopped = await to2
    expect(stopped?.error?.kind).toBe('abort')
    expect(stopped?.error?.body).toBe(reason)
    // A stop is the caller's own cancellation: loading ends, no error, the page stays.
    expect(pager.state).toMatchObject({ loading: false, target: null, error: null, page: 1 })

    const later = await pager.goTo(3)
    expect(later?.error?.kind).toBe('abort')
    expect(later?.error?.body).toBe(reason)
    expect(f.calls).toHaveLength(2)

    const g = fake()
    const gone = new AbortController()
    gone.abort()
    const dead = createPager(g.endpoint, base, { ...numbered, signal: gone.signal })
    expect((await dead.load())?.error?.kind).toBe('abort')
    expect(g.calls).toHaveLength(0)
  })

  it("the caller's signal stops the pager even when the endpoint ignores it", async () => {
    const f = fake({ honour: false })
    const controller = new AbortController()
    const pager = createPager(f.endpoint, base, { ...numbered, signal: controller.signal })
    const first = pager.load(); f.release(0); await first
    const to2 = pager.goTo(2)
    const reason = new Error('left the page')
    controller.abort(reason)
    f.release(1) // answers anyway, with page 2
    const stopped = await to2
    expect(stopped?.error?.kind).toBe('abort')
    expect(stopped?.error?.body).toBe(reason)
    expect(pager.state).toMatchObject({ loading: false, target: null, error: null, page: 1 })
    expect(shown(pager.state)).toBe(1)
  })

  it("a signal that isn't an AbortSignal: every move resolves kind 'middleware' and sends nothing", async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, { ...numbered, signal: {} as AbortSignal })
    for (const move of [() => pager.load(), () => pager.goTo(2), () => pager.refresh(), () => pager.setParams(base)]) {
      const result = move()
      await expect(result).resolves.toMatchObject({ data: null, error: { kind: 'middleware' } })
      expect((await result)?.error?.body).toBeInstanceOf(TypeError)
    }
    expect(f.calls).toHaveLength(0)
  })

  it('other CallOptions go with every request', async () => {
    const f = fake()
    const controller = new AbortController()
    const pager = createPager(f.endpoint, base, { ...numbered, headers: { 'x-team': 'a' }, timeout: 5000, signal: controller.signal })
    const a = pager.load(); f.release(0); await a
    void pager.goTo(2)
    for (const call of f.calls) {
      expect(call.options?.headers).toEqual({ 'x-team': 'a' })
      expect(call.options?.timeout).toBe(5000)
      expect(call.signal).toBeInstanceOf(AbortSignal)
      expect(call.signal).not.toBe(controller.signal)
      expect(call.options).not.toHaveProperty('toParams')
      expect(call.options).not.toHaveProperty('pageCount')
      expect(call.options).not.toHaveProperty('cache')
    }
  })
})
