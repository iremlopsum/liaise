// cacheMiddleware, 5.5.0 piece 2: skipping the cache refreshes its entry, the data it stores
// is frozen and shared by every hit, newer calls win, and clear() fences replies in flight.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApi } from '../src/create-api.js'
import { Request } from '../src/request.js'
import { createGraphQL, Operation, gql } from '../src/graphql.js'
import { cacheMiddleware, retryMiddleware } from '../src/built-in-middleware.js'
import { poll } from '../src/poll.js'
import type { Result, StandardSchemaV1 } from '../src/types.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A fetch that answers v: 1, 2, 3, … per call, unless `plan` says otherwise for that call. */
function versions(plan: Record<number, () => Response | Promise<Response>> = {}) {
  let n = 0
  const fetch = vi.fn(async () => { n++; return plan[n] ? plan[n]() : json({ v: n }) })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function restClient(where: 'endpoint' | 'client' = 'endpoint', extra: Parameters<typeof cacheMiddleware>[0] = {}) {
  const cache = cacheMiddleware({ ttl: 60_000, ...extra })
  const getUser = new Request<{ id: string }, { v: number }>({ method: 'GET', path: '/users/:id', ...(where === 'endpoint' ? { middleware: [cache] } : {}) })
  const api = createApi({ baseUrl: 'https://x.test', requests: { getUser }, ...(where === 'client' ? { middleware: [cache] } : {}) })
  return { cache, api }
}

describe('a skipped cache refreshes its entry', () => {
  it('a skipped call goes to the network and replaces the entry', async () => {
    const fetch = versions()
    const { cache, api } = restClient()
    await api.getUser({ id: '1' })
    const fresh = await api.getUser({ id: '1' }, { skipMiddleware: [cache] })
    const hit = await api.getUser({ id: '1' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fresh.data).toEqual({ v: 2 })
    expect(hit).toBe(fresh)
  })

  it('a failed refresh keeps the old entry', async () => {
    const fetch = versions({ 2: () => json({ message: 'down' }, 500) })
    const { cache, api } = restClient()
    const first = await api.getUser({ id: '1' })
    const failed = await api.getUser({ id: '1' }, { skipMiddleware: [cache] })
    const hit = await api.getUser({ id: '1' })
    expect(failed.error?.status).toBe(500)
    expect(hit).toBe(first)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('a refresh with no entry yet stores', async () => {
    const fetch = versions()
    const { cache, api } = restClient()
    const fresh = await api.getUser({ id: '1' }, { skipMiddleware: [cache] })
    expect(await api.getUser({ id: '1' })).toBe(fresh)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('client-level cache refreshes', async () => {
    const fetch = versions()
    const { cache, api } = restClient('client')
    await api.getUser({ id: '1' })
    const fresh = await api.getUser({ id: '1' }, { skipMiddleware: [cache] })
    expect(await api.getUser({ id: '1' })).toBe(fresh)
    expect(fresh.data).toEqual({ v: 2 })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('a declined method passes straight through the stand-in and stores nothing', async () => {
    const fetch = versions()
    const cache = cacheMiddleware({ ttl: 60_000 })
    const createUser = new Request<{ name: string }, { v: number }>({ method: 'POST', path: '/users', middleware: [cache] })
    const api = createApi({ baseUrl: 'https://x.test', requests: { createUser } })
    await api.createUser({ name: 'a' }, { skipMiddleware: [cache] })
    const again = await api.createUser({ name: 'a' })
    expect(again.data).toEqual({ v: 2 })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('retry outside the cache: the 503 is never stored, the success is', async () => {
    const fetch = versions({ 2: () => json({ message: 'busy' }, 503) })
    const cache = cacheMiddleware({ ttl: 60_000 })
    const getUser = new Request<{ id: string }, { v: number }>({ method: 'GET', path: '/users/:id', middleware: [retryMiddleware({ max: 1, delay: () => 0 }), cache] })
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser } })
    await api.getUser({ id: '1' })
    const fresh = await api.getUser({ id: '1' }, { skipMiddleware: [cache] })
    expect(fresh.data).toEqual({ v: 3 })
    expect(await api.getUser({ id: '1' })).toBe(fresh)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('debug logs REFRESH', async () => {
    versions()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { cache, api } = restClient('endpoint', { debug: true })
    await api.getUser({ id: '1' }, { skipMiddleware: [cache] })
    expect(log).toHaveBeenCalledWith('[liaise cache] REFRESH getUser {"id":"1"}')
  })

  it('retry() on a refreshed result refreshes again', async () => {
    const fetch = versions()
    const { cache, api } = restClient()
    await api.getUser({ id: '1' }, { skipMiddleware: [cache] })
    const hit = await api.getUser({ id: '1' })
    expect(hit.data).toEqual({ v: 1 }) // the refresh's own stored result
    const again = await hit.retry()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(again.data).toEqual({ v: 2 })
    expect(await api.getUser({ id: '1' })).toBe(again)
  })

  it('poll with skipMiddleware refreshes the entry', async () => {
    const fetch = versions()
    const { cache, api } = restClient()
    await api.getUser({ id: '1' })
    const ticked = new Promise<Result<{ v: number }>>(resolve => {
      const stop = poll(api.getUser, { id: '1' }, r => { stop(); resolve(r) }, { every: 60_000, skipMiddleware: [cache] })
    })
    const tick = await ticked
    expect(tick.data).toEqual({ v: 2 })
    expect((await api.getUser({ id: '1' })).data).toEqual({ v: 2 })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('the stand-in is not enumerable', () => {
    const cache = cacheMiddleware()
    const symbols = Object.getOwnPropertySymbols(cache)
    expect(symbols).toContain(Symbol.for('liaise.whenSkipped'))
    expect(symbols.every(s => !Object.getOwnPropertyDescriptor(cache, s)!.enumerable)).toBe(true)
  })
})

describe('GraphQL: refresh a query, never a mutation unless asked', () => {
  const Q = gql`query User($id: ID!) { user(id: $id) { v } }`
  const M = gql`mutation User($id: ID!) { touchUser(id: $id) { v } }`
  const client = (mutations = false) => {
    const cache = cacheMiddleware({ ttl: 60_000, methods: ['POST'], mutations })
    const c = createGraphQL({
      endpoint: 'https://x.test/graphql',
      middleware: [cache],
      queries: { user: new Operation<{ id: string }, { v: number }>({ operation: Q }) },
      mutations: { user: new Operation<{ id: string }, { v: number }>({ operation: M }) },
    })
    return { cache, c }
  }
  const gqlVersions = () => {
    let n = 0
    const fetch = vi.fn(async () => { n++; return json({ data: { v: n } }) })
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  it('a query refresh replaces the entry', async () => {
    const fetch = gqlVersions()
    const { cache, c } = client()
    await c.query.user({ id: '1' })
    const fresh = await c.query.user({ id: '1' }, { skipMiddleware: [cache] })
    expect(await c.query.user({ id: '1' })).toBe(fresh)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('a skipped mutation stores nothing', async () => {
    const fetch = gqlVersions()
    const { cache, c } = client()
    await c.mutation.user({ id: '1' }, { skipMiddleware: [cache] })
    await c.mutation.user({ id: '1' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('with mutations: true, a mutation refresh replaces like a query', async () => {
    const fetch = gqlVersions()
    const { cache, c } = client(true)
    await c.mutation.user({ id: '1' })
    const fresh = await c.mutation.user({ id: '1' }, { skipMiddleware: [cache] })
    expect(await c.mutation.user({ id: '1' })).toBe(fresh)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('stored data is frozen and shared', () => {
  it('stored data is frozen, for the first caller too, and hits share it', async () => {
    versions()
    const { api } = restClient()
    const first = await api.getUser({ id: '1' })
    const hit = await api.getUser({ id: '1' })
    expect(hit).toBe(first)
    expect(Object.isFrozen(first.data)).toBe(true)
    expect(() => { (first.data as { v: number }).v = 9 }).toThrow(TypeError)
  })

  it('a refreshed result is frozen too', async () => {
    versions()
    const { cache, api } = restClient()
    const fresh = await api.getUser({ id: '1' }, { skipMiddleware: [cache] })
    expect(Object.isFrozen(fresh.data)).toBe(true)
  })

  it('data the cache did not store is not frozen', async () => {
    versions()
    const cache = cacheMiddleware({ ttl: 60_000 })
    const createUser = new Request<{ name: string }, { v: number }>({ method: 'POST', path: '/users', middleware: [cache] })
    const api = createApi({ baseUrl: 'https://x.test', requests: { createUser } })
    const r = await api.createUser({ name: 'a' })
    expect(Object.isFrozen(r.data)).toBe(false)
  })

  it('maxSize 0 stores nothing and freezes nothing', async () => {
    versions()
    const { api } = restClient('endpoint', { maxSize: 0 })
    const r = await api.getUser({ id: '1' })
    expect(Object.isFrozen(r.data)).toBe(false)
  })

  it('a Date from a schema stays a working Date; a Blob response is cached and not frozen', async () => {
    let n = 0
    const fetch = vi.fn(async (url: unknown) => {
      n++
      return String(url).endsWith('/file')
        ? new Response('bytes', { headers: { 'Content-Type': 'application/octet-stream' } })
        : json({ at: '2026-01-01T00:00:00.000Z' })
    })
    vi.stubGlobal('fetch', fetch)
    const withDate: StandardSchemaV1<{ at: Date }> = {
      '~standard': { version: 1, vendor: 'test', validate: v => ({ value: { at: new Date((v as { at: string }).at) } }) },
    }
    const cache = cacheMiddleware({ ttl: 60_000 })
    const getEvent = new Request<void, { at: Date }>({ method: 'GET', path: '/event', schema: withDate, middleware: [cache] })
    const getFile = new Request<void, Blob>({ method: 'GET', path: '/file', responseType: 'blob', middleware: [cache] })
    const api = createApi({ baseUrl: 'https://x.test', requests: { getEvent, getFile } })

    const event = await api.getEvent()
    expect(Object.isFrozen(event.data)).toBe(true)
    expect(Object.isFrozen(event.data!.at)).toBe(false)
    event.data!.at.setTime(0)
    expect(event.data!.at.getTime()).toBe(0)

    const file = await api.getFile()
    expect(file.data).toBeInstanceOf(Blob)
    expect(Object.isFrozen(file.data)).toBe(false)
    expect(await api.getFile()).toBe(file)
    expect(n).toBe(2)
  })
})

describe('newer calls win; clear() fences replies in flight', () => {
  it('an older read finishing after a refresh does not put its answer back', async () => {
    let releaseSlow!: () => void
    versions({ 1: () => new Promise<Response>(r => { releaseSlow = () => r(json({ v: 'old' })) }) })
    const { cache, api } = restClient()
    const slow = api.getUser({ id: '1' })
    await new Promise(r => setTimeout(r, 0))
    const fresh = await api.getUser({ id: '1' }, { skipMiddleware: [cache] })
    releaseSlow()
    const old = await slow
    expect(old.data).toEqual({ v: 'old' })
    expect(Object.isFrozen(old.data)).toBe(false) // the store didn't take it
    expect(await api.getUser({ id: '1' })).toBe(fresh)
  })

  it('a reply in flight at clear() is not stored', async () => {
    let release!: () => void
    const fetch = versions({ 1: () => new Promise<Response>(r => { release = () => r(json({ v: 'before logout' })) }) })
    const { cache, api } = restClient()
    const inFlight = api.getUser({ id: '1' })
    await new Promise(r => setTimeout(r, 0))
    cache.clear()
    release()
    await inFlight
    const next = await api.getUser({ id: '1' })
    expect(next.data).toEqual({ v: 2 })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
