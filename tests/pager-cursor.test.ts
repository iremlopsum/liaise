import { describe, it, expect, vi, afterEach } from 'vitest'
import { createPager } from '../src/pager.js'
import type { CursorPagerOptions, PagerState } from '../src/pager.js'
import { ApiError, createNetworkErrorResult } from '../src/result.js'
import { errorResult, successResult } from '../src/testing.js'
import type { CallOptions, Result } from '../src/types.js'

type P = { limit: number; cursor?: string }
type D = { items: number[]; next: string | null; prev?: string | null }

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

/**
 * A cursor feed of `pages` pages, cursors 'c1'…: page n (1-based) is
 * `{ items: [n], next: 'c<n+1>' | null, prev: 'c<n-1>' | null }`; no cursor is page 1.
 * Every call waits until the test releases it, as in tests/pager.test.ts.
 */
function fake({ honour = true, pages = 5 } = {}) {
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
  const pageOf = (p: P) => (p.cursor === undefined ? 1 : Number(p.cursor.slice(1)))
  const sent = (i: number): Call => {
    expect(calls[i], `request ${i} was sent`).toBeDefined()
    return calls[i]!
  }
  const release = (i: number) => {
    sent(i)
    const n = pageOf(calls[i]!.params)
    calls[i]!.resolve(successResult<D>({
      items: [n],
      next: n < pages ? `c${n + 1}` : null,
      prev: n > 1 ? `c${n - 1}` : null,
    }))
  }
  const fail = (i: number, status = 500) => sent(i).resolve(errorResult<D>(status))
  return { endpoint, calls, release, fail, pageOf }
}

const base: P = { limit: 10 }
const cursors: CursorPagerOptions<P, D> = {
  next: (r, p) => (r.data.next ? { ...p, cursor: r.data.next } : null),
}
const withPrev: CursorPagerOptions<P, D> = {
  ...cursors,
  prev: (r, p) => (r.data.prev ? { ...p, cursor: r.data.prev } : null),
}
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))
const shown = (state: PagerState<P, D>) => state.data?.items[0] ?? null

afterEach(() => { vi.restoreAllMocks() })

describe('createPager: cursor pages', () => {
  it('load() opens the first page as page 1', async () => {
    const f = fake()
    const nextSpy = vi.fn(cursors.next)
    const pager = createPager(f.endpoint, base, { next: nextSpy })
    expect(f.calls).toHaveLength(0)
    const loading = pager.load()
    expect(f.calls.map(c => c.params)).toEqual([{ limit: 10 }])
    expect(pager.state).toMatchObject({ loading: true, target: 1 })
    f.release(0)
    const result = await loading
    expect(result?.data?.items).toEqual([1])
    // hasNext comes from calling next once on the landed page.
    expect(nextSpy).toHaveBeenCalledTimes(1)
    expect(pager.state).toMatchObject({
      loading: false, target: null, page: 1, pageCount: null, hasNext: true, hasPrev: false, params: { limit: 10 },
    })
  })

  it('next() walks forward; prev() goes back through visited pages from the cache, without a request', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, cursors)
    const a = pager.load(); f.release(0); const r1 = await a
    const b = pager.next()
    expect(f.calls[1]?.params).toEqual({ limit: 10, cursor: 'c2' })
    expect(pager.state).toMatchObject({ page: 1, target: 2, loading: true })
    f.release(1); const r2 = await b
    const c = pager.next(); f.release(2); await c
    expect(pager.state).toMatchObject({ page: 3, hasPrev: true, hasNext: true, params: { limit: 10, cursor: 'c3' } })

    expect(await pager.prev()).toBe(r2)
    expect(pager.state).toMatchObject({ page: 2, loading: false })
    expect(await pager.prev()).toBe(r1)
    expect(pager.state).toMatchObject({ page: 1, hasPrev: false })
    expect(shown(pager.state)).toBe(1)
    expect(f.calls).toHaveLength(3)

    // cache: false refetches, with the same params as before.
    const g = fake()
    const uncached = createPager(g.endpoint, base, { ...cursors, cache: false })
    const x = uncached.load(); g.release(0); await x
    const y = uncached.next(); g.release(1); await y
    const z = uncached.prev()
    expect(g.calls).toHaveLength(3)
    expect(g.calls[2]?.params).toEqual({ limit: 10 })
    g.release(2); await z
    expect(uncached.state.page).toBe(1)
    const w = uncached.next()
    expect(g.calls[3]?.params).toEqual({ limit: 10, cursor: 'c2' })
    g.release(3); await w
    expect(uncached.state.page).toBe(2)
  })

  it('goTo a visited page works; goTo an unvisited page resolves null and sends nothing', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, cursors)
    const a = pager.load(); f.release(0); const r1 = await a
    const b = pager.next(); f.release(1); await b
    const c = pager.next(); f.release(2); await c
    expect(await pager.goTo(1)).toBe(r1)
    expect(pager.state.page).toBe(1)
    // Page 4's cursor is known (page 3 named it), but it was never shown; 9 and 0 are nowhere.
    const nowhere = [pager.goTo(4), pager.goTo(9), pager.goTo(0), pager.goTo(1.5)]
    expect(f.calls).toHaveLength(3)
    expect(await Promise.all(nowhere)).toEqual([null, null, null, null])
    expect(pager.state.page).toBe(1)
    const to3 = pager.goTo(3)
    expect(f.calls).toHaveLength(3)
    expect((await to3)?.data?.items).toEqual([3])
  })

  it('next returning undefined → hasNext false; next() resolves null', async () => {
    const f = fake({ pages: 2 })
    const pager = createPager(f.endpoint, base, {
      next: (r, p) => (r.data.next ? { ...p, cursor: r.data.next } : undefined),
    })
    const a = pager.load(); f.release(0); await a
    const b = pager.next(); f.release(1); await b
    expect(pager.state).toMatchObject({ page: 2, hasNext: false })
    const past = pager.next()
    expect(f.calls).toHaveLength(2)
    expect(await past).toBeNull()
  })

  it('from: page null, hasPrev false without a prev option', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, { ...cursors, from: { limit: 10, cursor: 'c3' } })
    const a = pager.load()
    expect(f.calls[0]?.params).toEqual({ limit: 10, cursor: 'c3' })
    expect(pager.state).toMatchObject({ loading: true, target: null })
    f.release(0); await a
    expect(pager.state).toMatchObject({ page: null, hasPrev: false, hasNext: true, params: { limit: 10, cursor: 'c3' } })
    expect(shown(pager.state)).toBe(3)
    const back = pager.prev()
    expect(f.calls).toHaveLength(1)
    expect(await back).toBeNull()
    // Forward still works, and the numbers stay unknown; goTo has no numbers to go to.
    const b = pager.next(); f.release(1); await b
    expect(pager.state).toMatchObject({ page: null, hasPrev: true })
    expect(shown(pager.state)).toBe(4)
    expect(await pager.goTo(1)).toBeNull()
  })

  it('from with a prev option: prev() fetches the previous cursor\'s params; page stays null', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, { ...withPrev, from: { limit: 10, cursor: 'c3' } })
    const a = pager.load(); f.release(0); const r3 = await a
    expect(pager.state).toMatchObject({ page: null, hasPrev: true })
    const b = pager.prev()
    expect(f.calls[1]?.params).toEqual({ limit: 10, cursor: 'c2' })
    expect(pager.state.target).toBeNull()
    f.release(1); await b
    expect(pager.state).toMatchObject({ page: null, hasPrev: true, params: { limit: 10, cursor: 'c2' } })
    expect(shown(pager.state)).toBe(2)
    // The from page moved one step later in history, with its cache entry.
    expect(await pager.next()).toBe(r3)
    expect(f.calls).toHaveLength(2)
    // Back to c2 from the cache, then on to c1 (page 1), which has no previous page.
    const c = pager.prev()
    expect(f.calls).toHaveLength(2)
    await c
    const d = pager.prev()
    expect(f.calls[2]?.params).toEqual({ limit: 10, cursor: 'c1' })
    f.release(2); await d
    expect(pager.state).toMatchObject({ page: null, hasPrev: false })
    expect(shown(pager.state)).toBe(1)
  })

  it('a failed prev() from a from start leaves the shown page where next() and prev() count from it', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, { ...withPrev, from: { limit: 10, cursor: 'c3' } })
    const a = pager.load(); f.release(0); await a
    const b = pager.prev(); f.fail(1, 500); await b
    expect(pager.state).toMatchObject({ params: { limit: 10, cursor: 'c3' }, hasPrev: true, hasNext: true })
    expect(pager.state.error?.status).toBe(500)
    const c = pager.next()
    expect(f.calls[2]?.params).toEqual({ limit: 10, cursor: 'c4' })
    f.release(2); await c
    expect(shown(pager.state)).toBe(4)
    // Previous twice from c4: c3 from the cache, then c2 asked again with its remembered params.
    await pager.prev()
    expect(shown(pager.state)).toBe(3)
    const d = pager.prev()
    expect(f.calls[3]?.params).toEqual({ limit: 10, cursor: 'c2' })
    f.release(3); await d
    expect(shown(pager.state)).toBe(2)
  })

  it('setParams resets to the new first page; from is not used again; page becomes 1', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, { ...cursors, from: { limit: 10, cursor: 'c3' } })
    const a = pager.load(); f.release(0); await a
    const b = pager.next(); f.release(1); await b
    const c = pager.setParams({ limit: 20 })
    expect(f.calls[2]?.params).toEqual({ limit: 20 })
    expect(pager.state.target).toBe(1)
    f.release(2); await c
    expect(pager.state).toMatchObject({ page: 1, hasPrev: false, hasNext: true, params: { limit: 20 } })
    // The old history is gone: next asks for the new filter's page 2, not a cached one.
    const d = pager.next()
    expect(f.calls[3]?.params).toEqual({ limit: 20, cursor: 'c2' })
    f.release(3); await d
    expect(pager.state.page).toBe(2)
    // load() again opens the new first page (from the cache), not `from`.
    await pager.load()
    expect(f.calls).toHaveLength(4)
    expect(pager.state).toMatchObject({ page: 1, params: { limit: 20 } })
  })

  it("a throwing next resolves kind 'middleware' and leaves the shown page", async () => {
    const f = fake()
    const thrown = new Error('bad cursor')
    let fail = false
    const pager = createPager(f.endpoint, base, {
      next: (r, p) => {
        if (fail) throw thrown
        return cursors.next(r, p)
      },
    })
    const a = pager.load(); f.release(0); await a
    fail = true
    const b = pager.next(); f.release(1)
    const result = await b
    expect(result?.error?.kind).toBe('middleware')
    expect(result?.error?.body).toBe(thrown)
    expect(pager.state).toMatchObject({ page: 1, loading: false, target: null })
    expect(pager.state.error?.body).toBe(thrown)
    expect(shown(pager.state)).toBe(1)
  })

  it('an error keeps the shown page, and a retry of the same move works', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, cursors)
    const a = pager.load(); f.release(0); await a
    const b = pager.next(); f.fail(1, 503)
    expect((await b)?.error?.status).toBe(503)
    expect(pager.state).toMatchObject({ page: 1, loading: false, hasNext: true })
    expect(pager.state.error?.status).toBe(503)
    const c = pager.next(); f.release(2); await c
    expect(pager.state).toMatchObject({ page: 2, error: null })
  })

  for (const honour of [true, false]) {
    it(`latest wins across next/prev (${honour ? 'endpoint honours its signal' : 'endpoint ignores its signal'})`, async () => {
      const f = fake({ honour })
      const pager = createPager(f.endpoint, base, { ...cursors, cache: false })
      const a = pager.load(); f.release(0); await a
      const b = pager.next(); f.release(1); await b
      const seen: (number | null)[] = []
      pager.subscribe(() => seen.push(shown(pager.state)))

      const forward = pager.next() // page 3
      const back = pager.prev() // counts from page 3, the one loading: page 2
      expect(f.calls.map(c => f.pageOf(c.params))).toEqual([1, 2, 3, 2])
      expect(f.calls[2]!.signal!.aborted).toBe(true)
      expect(f.calls[2]!.signal!.reason).toMatchObject({ name: 'AbortError', message: 'Superseded by a newer move' })
      expect(f.calls[3]!.signal!.aborted).toBe(false)

      f.release(3); await back
      f.release(2) // the superseded page 3 answers late
      const late = await forward
      expect(late?.error?.kind).toBe('abort')
      await flush()
      expect(pager.state).toMatchObject({ page: 2, error: null, loading: false })
      expect(seen).not.toContain(3)
    })
  }

  it('next() while a page loads counts from the page loading', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, cursors)
    const a = pager.load(); f.release(0); await a
    const b = pager.next(); f.release(1); await b
    await pager.goTo(1)
    // Page 2 is known, so a second click while it loads goes on to page 3 only
    // once page 2 has named it: until then there is nowhere to go.
    void pager.next() // page 2, from the cache: lands at once
    const c = pager.next()
    expect(f.calls[2]?.params).toEqual({ limit: 10, cursor: 'c3' })
    expect(pager.state.target).toBe(3)
    const d = pager.next() // page 3 is loading and hasn't named page 4 yet
    expect(f.calls).toHaveLength(3)
    expect(await d).toBeNull()
    expect(pager.state.target).toBe(3)
    f.release(2); await c
    expect(pager.state.page).toBe(3)
  })

  it("the caller's signal stops a cursor move: no error, the page stays", async () => {
    const f = fake({ honour: false })
    const controller = new AbortController()
    const pager = createPager(f.endpoint, base, { ...cursors, signal: controller.signal })
    const a = pager.load(); f.release(0); await a
    const b = pager.next()
    const reason = new Error('left the page')
    controller.abort(reason)
    f.release(1)
    const stopped = await b
    expect(stopped?.error?.kind).toBe('abort')
    expect(stopped?.error?.body).toBe(reason)
    expect(pager.state).toMatchObject({ loading: false, target: null, error: null, page: 1 })
    expect((await pager.next())?.error?.body).toBe(reason)
    expect(f.calls).toHaveLength(2)
  })

  it('refresh() refetches the shown step past the cache', async () => {
    const f = fake()
    const pager = createPager(f.endpoint, base, cursors)
    const a = pager.load(); f.release(0); await a
    const b = pager.next(); f.release(1); const r2 = await b
    const c = pager.refresh()
    expect(f.calls[2]?.params).toEqual({ limit: 10, cursor: 'c2' })
    f.release(2); const r2b = await c
    expect(r2b).not.toBe(r2)
    await pager.prev()
    expect(await pager.next()).toBe(r2b)
    expect(f.calls).toHaveLength(3)
  })
})
