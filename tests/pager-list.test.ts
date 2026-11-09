import { describe, it, expect, vi, afterEach } from 'vitest'
import { createPager } from '../src/pager.js'
import type { PagerOptions } from '../src/pager.js'
import { ApiError, createNetworkErrorResult } from '../src/result.js'
import { errorResult, successResult } from '../src/testing.js'
import type { CallOptions, Result } from '../src/types.js'

type P = { limit: number; q?: string; page?: number; cursor?: string }
type D = { items: number[]; totalCount: number; next: string | null }

interface Call {
  params: P
  signal: AbortSignal | undefined
  resolve: (result: Result<D>) => void
}

function abortResult(reason: unknown, params: P): Result<D> {
  const error = new ApiError({ kind: 'abort', status: 0, statusText: '', body: reason, headers: new Headers(), request: { method: 'GET', url: '/feed', params } })
  const result: Result<D> = createNetworkErrorResult<D>(error, async () => result)
  return result
}

const pageOf = (p: P) => p.page ?? (p.cursor === undefined ? 1 : Number(p.cursor.slice(1)))

/**
 * A list of `pages` pages, two items each: page n holds `[n*10+1, n*10+2]` (plus
 * `shift`, so a test can tell a refetch from the first fetch), `totalCount` for
 * numbered pagers and `next: 'c<n+1>' | null` for cursor ones. `empty` makes that
 * page return no items. Every call waits until the test releases it.
 */
function fake({ honour = true, pages = 5, empty = 0 } = {}) {
  const calls: Call[] = []
  const endpoint = (params: P, options?: CallOptions): Promise<Result<D>> =>
    new Promise(resolve => {
      const signal = options?.signal
      calls.push({ params, signal, resolve })
      if (honour && signal) {
        const abort = () => resolve(abortResult(signal.reason, params))
        if (signal.aborted) abort()
        else signal.addEventListener('abort', abort, { once: true })
      }
    })
  const sent = (i: number): Call => {
    expect(calls[i], `request ${i} was sent`).toBeDefined()
    return calls[i]!
  }
  const state = { shift: 0 }
  const release = (i: number) => {
    const n = pageOf(sent(i).params)
    calls[i]!.resolve(successResult<D>({
      items: n === empty ? [] : [n * 10 + 1 + state.shift, n * 10 + 2 + state.shift],
      totalCount: pages * 2,
      next: n < pages ? `c${n + 1}` : null,
    }))
  }
  const fail = (i: number, status = 500) => sent(i).resolve(errorResult<D>(status))
  return { endpoint, calls, release, fail, state }
}

const base: P = { limit: 2 }
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

const modes: { name: string; options: PagerOptions<P, D, number>; params: (n: number, p?: P) => P }[] = [
  {
    name: 'numbered',
    options: {
      toParams: (n, p) => ({ ...p, page: n }),
      pageCount: r => Math.ceil(r.data.totalCount / 2),
      items: r => r.data.items,
    },
    params: (n, p = base) => ({ ...p, page: n }),
  },
  {
    name: 'cursor',
    options: {
      next: (r, p) => (r.data.next ? { ...p, cursor: r.data.next } : null),
      items: r => r.data.items,
    },
    params: (n, p = base) => (n === 1 ? { ...p } : { ...p, cursor: `c${n}` }),
  },
]

afterEach(() => { vi.restoreAllMocks() })

describe.each(modes)('createPager: list mode ($name)', ({ name, options, params }) => {
  it('load() fetches page 1. next() appends its items. state.loaded counts pages', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, options)
    expect(f.calls).toHaveLength(0)
    expect(pager.state).toMatchObject({ items: [], loaded: 0, hasNext: false })
    const first = pager.load()
    expect(f.calls.map(c => c.params)).toEqual([params(1)])
    expect(pager.state).toMatchObject({ loading: true, target: 1 })
    f.release(0)
    const r1 = await first
    expect(r1?.data?.items).toEqual([11, 12])
    const after1 = pager.state.items
    expect(pager.state).toMatchObject({ loading: false, target: null, items: [11, 12], loaded: 1, page: 1, hasNext: true, hasPrev: false, params: params(1) })
    expect(Object.isFrozen(after1)).toBe(true)

    const second = pager.next()
    expect(f.calls[1]?.params).toEqual(params(2))
    expect(pager.state).toMatchObject({ loading: true, target: 2, items: [11, 12], loaded: 1 })
    // Nothing about the items changed yet: the same array.
    expect(pager.state.items).toBe(after1)
    f.release(1)
    await second
    expect(pager.state).toMatchObject({ loading: false, items: [11, 12, 21, 22], loaded: 2, page: 2, params: params(2) })
    expect(pager.state.items).not.toBe(after1)
    expect(Object.isFrozen(pager.state.items)).toBe(true)
    // The earlier array is untouched.
    expect(after1).toEqual([11, 12])
    expect(pager.state.data?.items).toEqual([21, 22])
  })

  it('next() while one is in flight returns the same promise and sends once', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, options)
    const first = pager.load(); f.release(0); await first
    const a = pager.next()
    const b = pager.next()
    expect(b).toBe(a)
    expect(f.calls).toHaveLength(2)
    f.release(1)
    expect(await b).toBe(await a)
    expect(pager.state.loaded).toBe(2)
    // After it settled, next() moves again.
    const c = pager.next()
    expect(c).not.toBe(a)
    expect(f.calls[2]?.params).toEqual(params(3))
  })

  it('restore: 3 fetches pages 1..3 in order, one at a time', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, { ...options, restore: 3 })
    const loading = pager.load()
    expect(f.calls.map(c => c.params)).toEqual([params(1)])
    await flush()
    // The second waits for the first.
    expect(f.calls).toHaveLength(1)
    f.release(0)
    await flush()
    expect(f.calls.map(c => c.params)).toEqual([params(1), params(2)])
    expect(pager.state).toMatchObject({ loading: true, items: [11, 12], loaded: 1, target: 2 })
    f.release(1)
    await flush()
    expect(f.calls.map(c => c.params)).toEqual([params(1), params(2), params(3)])
    expect(pager.state).toMatchObject({ loading: true, items: [11, 12, 21, 22], loaded: 2, target: 3 })
    f.release(2)
    const result = await loading
    expect(result?.data?.items).toEqual([31, 32])
    expect(pager.state).toMatchObject({ loading: false, target: null, items: [11, 12, 21, 22, 31, 32], loaded: 3, page: 3, hasNext: true, error: null })
    expect(f.calls).toHaveLength(3)
  })

  it('a failure during restore stops there: error set, loaded = pages that succeeded, hasNext true; next() retries the failed page', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, { ...options, restore: 3 })
    const loading = pager.load()
    f.release(0); await flush()
    f.fail(1)
    const result = await loading
    expect(result?.error?.status).toBe(500)
    await flush()
    expect(f.calls).toHaveLength(2)
    expect(pager.state).toMatchObject({ loading: false, target: null, items: [11, 12], loaded: 1, hasNext: true })
    expect(pager.state.error?.status).toBe(500)

    const retry = pager.next()
    expect(f.calls[2]?.params).toEqual(params(2))
    f.release(2)
    await retry
    expect(pager.state).toMatchObject({ items: [11, 12, 21, 22], loaded: 2, error: null })
  })

  it('a failure on the first page leaves the list empty; next() fetches page 1', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, { ...options, restore: 2 })
    const loading = pager.load()
    f.fail(0)
    await loading
    expect(pager.state).toMatchObject({ loading: false, items: [], loaded: 0, hasNext: true })
    expect(pager.state.error?.status).toBe(500)
    const retry = pager.next()
    expect(f.calls[1]?.params).toEqual(params(1))
    f.release(1)
    await retry
    expect(pager.state).toMatchObject({ items: [11, 12], loaded: 1, error: null })
  })

  it('an empty items page ends the list (hasNext false)', async () => {
    const f = fake({ empty: 2 })
    const pager = createPager(f.endpoint, base, { ...options, restore: 4 })
    const loading = pager.load()
    f.release(0); await flush()
    f.release(1)
    await flush()
    // Asserted before awaiting: a list that didn't end would wait for page 3.
    expect(f.calls).toHaveLength(2)
    expect(pager.state.loading).toBe(false)
    await loading
    expect(pager.state).toMatchObject({ loading: false, items: [11, 12], loaded: 2, hasNext: false })
    expect(await pager.next()).toBeNull()
    expect(f.calls).toHaveLength(2)
  })

  it(name === 'numbered' ? 'so does pageCount reached' : 'so does next returning nothing', async () => {
    const f = fake({ pages: 2 })
    const pager = createPager(f.endpoint, base, { ...options, restore: 5 })
    const loading = pager.load()
    f.release(0); await flush()
    f.release(1)
    await flush()
    // Asserted before awaiting: a list that didn't end would wait for page 3.
    expect(f.calls).toHaveLength(2)
    expect(pager.state.loading).toBe(false)
    await loading
    expect(pager.state).toMatchObject({ loaded: 2, hasNext: false, items: [11, 12, 21, 22] })
    expect(await pager.next()).toBeNull()
    expect(f.calls).toHaveLength(2)
  })

  it('goTo and prev resolve null in list mode', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, options)
    const first = pager.load(); f.release(0); await first
    const second = pager.next(); f.release(1); await second
    const before = pager.state
    const to1 = pager.goTo(1)
    const back = pager.prev()
    expect(f.calls).toHaveLength(2)
    expect(await to1).toBeNull()
    expect(await back).toBeNull()
    expect(pager.state).toBe(before)
  })

  it('refresh() reloads pages 1..loaded and replaces items; setParams clears items and loads page 1', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, options)
    const first = pager.load(); f.release(0); await first
    const second = pager.next(); f.release(1); await second
    const shown = pager.state.items
    f.state.shift = 100
    const refreshing = pager.refresh()
    expect(f.calls[2]?.params).toEqual(params(1))
    f.release(2); await flush()
    expect(f.calls[3]?.params).toEqual(params(2))
    // The old items stay until the refresh is done.
    expect(pager.state).toMatchObject({ loading: true, items: shown, loaded: 2 })
    f.release(3)
    await refreshing
    expect(pager.state).toMatchObject({ loading: false, items: [111, 112, 121, 122], loaded: 2, page: 2 })
    expect(f.calls).toHaveLength(4)

    const filtered = pager.setParams({ limit: 2, q: 'x' })
    expect(pager.state).toMatchObject({ loading: true, items: [], loaded: 0, target: 1 })
    expect(f.calls).toHaveLength(5)
    expect(f.calls[4]?.params).toEqual(params(1, { limit: 2, q: 'x' }))
    f.release(4)
    await filtered
    expect(pager.state).toMatchObject({ loading: false, items: [111, 112], loaded: 1, params: params(1, { limit: 2, q: 'x' }) })
    // next() follows the new params.
    void pager.next()
    expect(f.calls[5]?.params).toEqual(params(2, { limit: 2, q: 'x' }))
  })

  it("the caller's signal aborting mid-restore: no further request, loading false, loaded = pages that arrived", async () => {
    // Between pages: aborted the moment page 2 lands, before page 3 is asked for.
    const f = fake()
    const controller = new AbortController()
    const reason = new Error('left the page')
    const pager = createPager(f.endpoint, base, { ...options, restore: 3, signal: controller.signal })
    pager.subscribe(() => { if (pager.state.loaded === 2) controller.abort(reason) })
    const loading = pager.load()
    f.release(0); await flush()
    f.release(1)
    const result = await loading
    await flush()
    expect(f.calls).toHaveLength(2)
    expect(result?.error?.kind).toBe('abort')
    expect(result?.error?.body).toBe(reason)
    expect(pager.state).toMatchObject({ loading: false, target: null, loaded: 2, items: [11, 12, 21, 22], error: null })

    // While a page is in flight: that request is aborted, and nothing follows it.
    const g = fake()
    const stop = new AbortController()
    const other = createPager(g.endpoint, base, { ...options, restore: 3, signal: stop.signal })
    const restoring = other.load()
    g.release(0); await flush()
    stop.abort(reason)
    expect(g.calls[1]!.signal!.aborted).toBe(true)
    expect((await restoring)?.error?.body).toBe(reason)
    await flush()
    expect(g.calls).toHaveLength(2)
    expect(other.state).toMatchObject({ loading: false, target: null, loaded: 1, items: [11, 12], error: null })
  })

  for (const honour of [true, false]) {
    it(`setParams during restore aborts the restore; none of the old items land (${honour ? 'honours' : 'ignores'} its signal)`, async () => {
      const f = fake({ honour })
      const pager = createPager(f.endpoint, base, { ...options, restore: 3 })
      const restoring = pager.load()
      f.release(0); await flush()
      expect(f.calls).toHaveLength(2)
      const filtered = pager.setParams({ limit: 2, q: 'x' })
      expect(f.calls[1]!.signal!.aborted).toBe(true)
      expect(pager.state).toMatchObject({ items: [], loaded: 0, loading: true })
      f.release(1) // the old restore's page 2 (ignored by an endpoint that honours its signal)
      const old = await restoring
      expect(old?.error?.kind).toBe('abort')
      expect(old?.error?.body).toBeInstanceOf(DOMException)
      await flush()
      // The old restore asked for nothing more.
      expect(f.calls).toHaveLength(3)
      expect(pager.state).toMatchObject({ items: [], loaded: 0, loading: true })
      f.release(2)
      await filtered
      expect(pager.state).toMatchObject({ items: [11, 12], loaded: 1, loading: false, params: params(1, { limit: 2, q: 'x' }) })
    })
  }

  it("a throwing items callback resolves kind 'middleware' and keeps the pages before it", async () => {
    const f = fake()
    const boom = new Error('no items field')
    const pager = createPager(f.endpoint, base, {
      ...options, restore: 3, items: r => { if (r.data.items[0] === 21) throw boom; return r.data.items },
    })
    const loading = pager.load()
    f.release(0); await flush()
    f.release(1)
    const result = await loading
    expect(result?.error?.kind).toBe('middleware')
    expect(result?.error?.body).toBe(boom)
    await flush()
    expect(f.calls).toHaveLength(2)
    expect(pager.state).toMatchObject({ loading: false, loaded: 1, items: [11, 12], hasNext: true })
    expect(pager.state.error?.body).toBe(boom)
  })

  // The reference page states these: a list always starts at page 1, and `restore` is sanitised.
  it('restore that is not a whole number of at least 1: below 1 or not finite loads one page, a fraction is rounded down', async () => {
    for (const restore of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const f = fake()
      const pager = createPager(f.endpoint, base, { ...options, restore })
      void pager.load()
      f.release(0); await flush()
      // Counted without awaiting the load: one that asked for page 2 would never settle here.
      expect(f.calls, `restore: ${restore}`).toHaveLength(1)
      expect(pager.state).toMatchObject({ loading: false, loaded: 1 })
    }
    const f = fake()
    const pager = createPager(f.endpoint, base, { ...options, restore: 2.7 })
    void pager.load()
    f.release(0); await flush()
    f.release(1); await flush()
    expect(f.calls.map(c => c.params)).toEqual([params(1), params(2)])
    expect(pager.state).toMatchObject({ loading: false, loaded: 2 })
  })

  it('a list ignores start, from and cache: it opens at page 1 and keeps every page in items', async () => {
    const f = fake()
    const ignored = name === 'numbered' ? { start: 3, cache: false } : { from: params(3), cache: false }
    const pager = createPager(f.endpoint, base, { ...options, ...ignored } as PagerOptions<P, D, number>)
    const first = pager.load()
    expect(f.calls.map(c => c.params)).toEqual([params(1)])
    f.release(0); await first
    const second = pager.next(); f.release(1); await second
    expect(f.calls.map(c => c.params)).toEqual([params(1), params(2)])
    expect(pager.state).toMatchObject({ page: 2, loaded: 2, items: [11, 12, 21, 22] })
  })

  // A refresh replaces the list only when it succeeds: a failure keeps the list it would have replaced.
  /** A pager with pages 1..3 loaded (`[11, 12, 21, 22, 31, 32]`), and every later page shifted by 100. */
  async function loadedThree(f: ReturnType<typeof fake>, extra: Partial<PagerOptions<P, D, number>> = {}, signal?: AbortSignal) {
    const pager = createPager(f.endpoint, base, { ...options, ...extra, restore: 3, signal } as PagerOptions<P, D, number>)
    const loading = pager.load()
    f.release(0); await flush()
    f.release(1); await flush()
    f.release(2); await loading
    f.state.shift = 100
    return pager
  }
  const keeps = (pager: { state: unknown }, before: { items: readonly number[]; data: D | null; params: P | null }) => {
    expect(pager.state).toMatchObject({ loading: false, target: null, loaded: 3, page: 3, hasNext: false, pageCount: name === 'numbered' ? 3 : null })
    const state = pager.state as typeof before
    expect(state.items).toBe(before.items)
    expect(state.data).toBe(before.data)
    expect(state.params).toEqual(before.params)
  }

  it('a refresh that fails on page 1 keeps the list: only error is set', async () => {
    const f = fake({ pages: 3 })
    const pager = await loadedThree(f)
    const before = pager.state
    expect(before).toMatchObject({ items: [11, 12, 21, 22, 31, 32], loaded: 3, hasNext: false })
    const refreshing = pager.refresh()
    f.fail(3)
    const result = await refreshing
    expect(result?.error?.status).toBe(500)
    keeps(pager, before)
    expect(pager.state.error?.status).toBe(500)
    expect(f.calls).toHaveLength(4)
  })

  it('a refresh that fails on a later page keeps the old list, not the pages it refetched', async () => {
    const f = fake({ pages: 3 })
    const pager = await loadedThree(f)
    const before = pager.state
    const refreshing = pager.refresh()
    f.release(3); await flush()
    expect(f.calls[4]?.params).toEqual(params(2))
    f.fail(4)
    await refreshing
    await flush()
    expect(f.calls).toHaveLength(5)
    keeps(pager, before)
    expect(pager.state.items).toEqual([11, 12, 21, 22, 31, 32])
    expect(pager.state.error?.status).toBe(500)
    // A later refresh that succeeds replaces it, and clears the error.
    const again = pager.refresh()
    f.release(5); await flush()
    f.release(6); await flush()
    f.release(7); await again
    expect(pager.state).toMatchObject({ items: [111, 112, 121, 122, 131, 132], loaded: 3, error: null })
  })

  const throwers: [string, (boom: Error) => Partial<PagerOptions<P, D, number>>][] = [
    ['items', boom => ({ items: (r: Result<D>) => { if (r.data?.items[0] === 121) throw boom; return r.data!.items } })],
    name === 'numbered'
      ? ['pageCount', boom => ({ pageCount: (r: Result<D>) => { if (r.data?.items[0] === 121) throw boom; return 3 } })]
      : ['next', boom => ({ next: (r: Result<D>, p: P) => { if (r.data?.items[0] === 121) throw boom; return r.data!.next ? { ...p, cursor: r.data!.next } : null } })],
  ]
  for (const [callback, make] of throwers) {
    it(`a throwing ${callback} during a refresh keeps the list and sets error`, async () => {
      const f = fake({ pages: 3 })
      const boom = new Error(`${callback} broke`)
      const pager = await loadedThree(f, make(boom))
      const before = pager.state
      const refreshing = pager.refresh()
      f.release(3); await flush()
      f.release(4)
      const result = await refreshing
      expect(result?.error?.kind).toBe('middleware')
      expect(result?.error?.body).toBe(boom)
      await flush()
      expect(f.calls).toHaveLength(5)
      keeps(pager, before)
      expect(pager.state.error?.body).toBe(boom)
    })
  }

  it("the caller's signal stopping a refresh in flight keeps the old items", async () => {
    const f = fake({ pages: 3 })
    const stop = new AbortController()
    const reason = new Error('left the page')
    const pager = await loadedThree(f, {}, stop.signal)
    const before = pager.state
    const refreshing = pager.refresh()
    f.release(3); await flush()
    stop.abort(reason)
    expect(f.calls[4]!.signal!.aborted).toBe(true)
    const result = await refreshing
    expect(result?.error?.kind).toBe('abort')
    expect(result?.error?.body).toBe(reason)
    await flush()
    expect(f.calls).toHaveLength(5)
    keeps(pager, before)
    expect(pager.state.error).toBeNull()
  })

  it('load() on a loaded list starts over: it rebuilds pages 1..restore', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, { ...options, restore: 2 })
    const loading = pager.load()
    f.release(0); await flush()
    f.release(1); await loading
    const more = pager.next(); f.release(2); await more
    expect(pager.state).toMatchObject({ loaded: 3, items: [11, 12, 21, 22, 31, 32] })
    f.state.shift = 100
    const reloading = pager.load()
    expect(pager.state).toMatchObject({ loading: true, items: [], loaded: 0, target: 1 })
    expect(f.calls[3]?.params).toEqual(params(1))
    f.release(3); await flush()
    expect(f.calls[4]?.params).toEqual(params(2))
    f.release(4); await reloading
    await flush()
    expect(f.calls).toHaveLength(5)
    expect(pager.state).toMatchObject({ loading: false, loaded: 2, items: [111, 112, 121, 122], hasNext: true })
  })

  it("next() during a restore returns the restore's promise and sends nothing extra", async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, { ...options, restore: 3 })
    const restoring = pager.load()
    expect(pager.next()).toBe(restoring)
    expect(f.calls).toHaveLength(1)
    f.release(0); await flush()
    expect(pager.next()).toBe(restoring)
    expect(f.calls).toHaveLength(2)
    f.release(1); await flush()
    f.release(2)
    await restoring
    await flush()
    expect(f.calls.map(c => c.params)).toEqual([params(1), params(2), params(3)])
    expect(pager.state).toMatchObject({ loaded: 3, loading: false })
  })
})
