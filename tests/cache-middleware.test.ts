import { describe, it, expect, vi, afterEach } from 'vitest'
import { CacheStore } from '../src/utils/cache.js'
import { createApi } from '../src/create-api.js'
import { Request } from '../src/request.js'
import { cacheMiddleware } from '../src/built-in-middleware.js'
import type { FetchOptions, Middleware } from '../src/types.js'
import { createGraphQL, Operation } from '../src/graphql.js'
import { clientFetchOf } from '../src/utils/client-fetch.js'

afterEach(() => vi.restoreAllMocks())

function mockJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// CacheStore
// ---------------------------------------------------------------------------

describe('CacheStore', () => {
  it('returns null for an unknown key', () => {
    const store = new CacheStore({ ttl: 60_000, maxSize: 10 })
    expect(store.get('missing')).toBeNull()
  })

  it('returns a stored value within TTL', () => {
    const store = new CacheStore({ ttl: 60_000, maxSize: 10 })
    store.set('key', { name: 'Alice' })
    expect(store.get('key')).toEqual({ name: 'Alice' })
  })

  it('returns null after TTL expires and deletes the entry', () => {
    const dateSpy = vi.spyOn(Date, 'now')
    dateSpy.mockReturnValue(0)
    const store = new CacheStore({ ttl: 1000, maxSize: 10 })
    store.set('key', 'value')
    dateSpy.mockReturnValue(1001) // past TTL
    expect(store.get('key')).toBeNull()
    // confirm the entry was removed (not merely skipped)
    dateSpy.mockReturnValue(500) // back inside what would have been TTL
    expect(store.get('key')).toBeNull()
  })

  it('returns null exactly at TTL boundary', () => {
    const dateSpy = vi.spyOn(Date, 'now')
    dateSpy.mockReturnValue(0)
    const store = new CacheStore({ ttl: 1000, maxSize: 10 })
    store.set('key', 'value')
    dateSpy.mockReturnValue(1000) // exactly at TTL
    expect(store.get('key')).toBeNull()
  })

  it('clears all entries', () => {
    const store = new CacheStore({ ttl: 60_000, maxSize: 10 })
    store.set('a', 1)
    store.set('b', 2)
    store.clear()
    expect(store.get('a')).toBeNull()
    expect(store.get('b')).toBeNull()
  })

  it('evicts the oldest entry when maxSize is reached', () => {
    const dateSpy = vi.spyOn(Date, 'now')
    dateSpy.mockReturnValue(0)
    const store = new CacheStore({ ttl: 60_000, maxSize: 2 })
    store.set('a', 'first')   // timestamp 0 — oldest
    dateSpy.mockReturnValue(1)
    store.set('b', 'second')  // timestamp 1
    dateSpy.mockReturnValue(2)
    store.set('c', 'third')   // triggers eviction of 'a'
    expect(store.get('a')).toBeNull()    // evicted
    expect(store.get('b')).toBe('second')
    expect(store.get('c')).toBe('third')
  })
})

// ---------------------------------------------------------------------------
// cacheMiddleware
// ---------------------------------------------------------------------------

describe('cacheMiddleware', () => {
  it('returns cached result on second call without hitting network', async () => {
    let callCount = 0
    vi.stubGlobal('fetch', async () => {
      callCount++
      return mockJsonResponse({ name: 'Alice' })
    })
    const cache = cacheMiddleware({ ttl: 60_000 })
    const getUser = new Request<{ id: string }, { name: string }>({
      method: 'GET',
      path: '/users/:id',
      middleware: [cache],
    })
    const api = createApi({ baseUrl: '', requests: { getUser } })

    const first = await api.getUser({ id: '1' })
    const second = await api.getUser({ id: '1' })

    expect(callCount).toBe(1)
    expect(second.data).toEqual({ name: 'Alice' })
    expect(second.error).toBeNull()
  })

  it('fetches independently for different params', async () => {
    let callCount = 0
    vi.stubGlobal('fetch', async () => { callCount++; return mockJsonResponse({}) })
    const cache = cacheMiddleware({ ttl: 60_000 })
    const getUser = new Request<{ id: string }, unknown>({
      method: 'GET',
      path: '/users/:id',
      middleware: [cache],
    })
    const api = createApi({ baseUrl: '', requests: { getUser } })

    await api.getUser({ id: '1' })
    await api.getUser({ id: '2' })

    expect(callCount).toBe(2)
  })

  it('fetches again after TTL expires', async () => {
    let callCount = 0
    vi.stubGlobal('fetch', async () => { callCount++; return mockJsonResponse({}) })
    const dateSpy = vi.spyOn(Date, 'now')
    dateSpy.mockReturnValue(0)

    const cache = cacheMiddleware({ ttl: 1000 })
    const getUser = new Request<{ id: string }, unknown>({
      method: 'GET',
      path: '/users/:id',
      middleware: [cache],
    })
    const api = createApi({ baseUrl: '', requests: { getUser } })

    await api.getUser({ id: '1' })
    dateSpy.mockReturnValue(1001)
    await api.getUser({ id: '1' })

    expect(callCount).toBe(2)
  })

  it('does not cache error responses', async () => {
    let callCount = 0
    vi.stubGlobal('fetch', async () => {
      callCount++
      return new Response(null, { status: 404 })
    })
    const cache = cacheMiddleware({ ttl: 60_000 })
    const getUser = new Request<{ id: string }, unknown>({
      method: 'GET',
      path: '/users/:id',
      middleware: [cache],
    })
    const api = createApi({ baseUrl: '', requests: { getUser } })

    await api.getUser({ id: '1' })
    await api.getUser({ id: '1' })

    expect(callCount).toBe(2)
  })

  it('does not cache network errors', async () => {
    let callCount = 0
    vi.stubGlobal('fetch', async () => {
      callCount++
      throw new TypeError('Failed to fetch')
    })
    const cache = cacheMiddleware({ ttl: 60_000 })
    const getUser = new Request<{ id: string }, unknown>({
      method: 'GET',
      path: '/users/:id',
      middleware: [cache],
    })
    const api = createApi({ baseUrl: '', requests: { getUser } })

    await api.getUser({ id: '1' })
    await api.getUser({ id: '1' })

    expect(callCount).toBe(2)
  })

  it('evicts oldest entry when maxSize is reached', async () => {
    const dateSpy = vi.spyOn(Date, 'now')
    let t = 0
    dateSpy.mockImplementation(() => t++)

    const responses: Record<string, string> = { '1': 'Alice', '2': 'Bob', '3': 'Carol' }
    vi.stubGlobal('fetch', async (url: string) => {
      const id = String(url).split('/').pop()!
      return mockJsonResponse({ name: responses[id] })
    })

    // maxSize: 2 — stores up to 2 entries; adding a 3rd evicts the oldest (id '1')
    const cache = cacheMiddleware({ ttl: 60_000, maxSize: 2 })
    const getUser = new Request<{ id: string }, { name: string }>({
      method: 'GET',
      path: '/users/:id',
      middleware: [cache],
    })
    const api = createApi({ baseUrl: '', requests: { getUser } })

    // Phase 1: fill cache; id '1' is the oldest and gets evicted when id '3' is stored
    await api.getUser({ id: '1' }) // stored — oldest
    await api.getUser({ id: '2' }) // stored
    await api.getUser({ id: '3' }) // triggers eviction of id '1'; store = {'2','3'}

    // Phase 2: replace fetch stub; count new network calls
    let fetchCount = 0
    vi.stubGlobal('fetch', async () => { fetchCount++; return mockJsonResponse({ name: 'refetched' }) })

    // id '2' and '3' are still cached — no fetches needed
    await api.getUser({ id: '2' })
    await api.getUser({ id: '3' })
    expect(fetchCount).toBe(0)

    // id '1' was evicted — must fetch
    await api.getUser({ id: '1' })
    expect(fetchCount).toBe(1)
  })

  it('clears all entries and fetches again', async () => {
    let callCount = 0
    vi.stubGlobal('fetch', async () => { callCount++; return mockJsonResponse({}) })
    const cache = cacheMiddleware({ ttl: 60_000 })
    const getUser = new Request<{ id: string }, unknown>({
      method: 'GET',
      path: '/users/:id',
      middleware: [cache],
    })
    const api = createApi({ baseUrl: '', requests: { getUser } })

    await api.getUser({ id: '1' })
    cache.clear()
    await api.getUser({ id: '1' })

    expect(callCount).toBe(2)
  })

  it('logs HIT and MISS to console when debug is true', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal('fetch', async () => mockJsonResponse({}))
    const cache = cacheMiddleware({ ttl: 60_000, debug: true })
    const getUser = new Request<{ id: string }, unknown>({
      method: 'GET',
      path: '/users/:id',
      middleware: [cache],
    })
    const api = createApi({ baseUrl: '', requests: { getUser } })

    await api.getUser({ id: '1' }) // MISS
    await api.getUser({ id: '1' }) // HIT

    expect(logSpy).toHaveBeenCalledTimes(2)
    expect(logSpy).toHaveBeenNthCalledWith(1, expect.stringContaining('[liaise cache] MISS'))
    expect(logSpy).toHaveBeenNthCalledWith(2, expect.stringContaining('[liaise cache] HIT'))
  })

  it('does not log when debug is omitted', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal('fetch', async () => mockJsonResponse({}))
    const cache = cacheMiddleware({ ttl: 60_000 })
    const getUser = new Request<{ id: string }, unknown>({
      method: 'GET',
      path: '/users/:id',
      middleware: [cache],
    })
    const api = createApi({ baseUrl: '', requests: { getUser } })

    await api.getUser({ id: '1' })
    await api.getUser({ id: '1' })

    expect(logSpy).not.toHaveBeenCalled()
  })

  it('treats params with different key order as the same cache entry', async () => {
    let callCount = 0
    vi.stubGlobal('fetch', async () => { callCount++; return mockJsonResponse({}) })
    const cache = cacheMiddleware({ ttl: 60_000 })
    const search = new Request<{ q: string; page: number }, unknown>({
      method: 'GET',
      path: '/search',
      middleware: [cache],
    })
    const api = createApi({ baseUrl: '', requests: { search } })

    await api.search({ q: 'hello', page: 1 })
    const altOrderParams: { q: string; page: number } = { page: 1, q: 'hello' }
    await api.search(altOrderParams)

    expect(callCount).toBe(1)
  })

  it('two separate instances never share cache entries', async () => {
    let callCount = 0
    vi.stubGlobal('fetch', async () => { callCount++; return mockJsonResponse({}) })
    const cacheA = cacheMiddleware({ ttl: 60_000 })
    const cacheB = cacheMiddleware({ ttl: 60_000 })
    const getUser = new Request<{ id: string }, unknown>({
      method: 'GET',
      path: '/users/:id',
    })
    const apiA = createApi({ baseUrl: '', requests: { getUser }, middleware: [cacheA] })
    const apiB = createApi({ baseUrl: '', requests: { getUser }, middleware: [cacheB] })

    await apiA.getUser({ id: '1' })
    await apiB.getUser({ id: '1' }) // different store — must fetch

    expect(callCount).toBe(2)
  })
  // ---------------------------------------------------------------------------
  // FIXES audit #14: stableStringify collapses FormData, Blob, ArrayBuffer
  // and URLSearchParams to the literal string "{}" — it falls through to
  // Object.keys() for any object, and Object.keys() returns [] for all of them
  // regardless of content. Two different uploads through one cache therefore
  // produced the identical key and served each other's responses. `share` was
  // given a guard against this exact collapse in 2.2.0; the cache had none.
  // ---------------------------------------------------------------------------
  it('never serves one special-body payload the response to another', async () => {
    const bodies = ['A', 'B']
    let n = 0
    const fetchMock = vi.fn(async () => mockJsonResponse({ who: bodies[n++] }))
    vi.stubGlobal('fetch', fetchMock)

    const cache = cacheMiddleware({ ttl: 60_000, methods: ['POST'] })
    const api = createApi({
      baseUrl: '',
      requests: {
        upload: new Request<FormData, { who: string }>({ method: 'POST', path: '/upload', middleware: [cache] }),
      },
    })

    const a = new FormData(); a.append('payload', 'SECRET-A')
    const b = new FormData(); b.append('payload', 'SECRET-B')

    const rA = await api.upload(a)
    const rB = await api.upload(b)

    expect(fetchMock.mock.calls.length).toBe(2)   // B must reach the network
    expect(rA.data).toEqual({ who: 'A' })
    expect(rB.data).toEqual({ who: 'B' })         // never A's cached response
  })

  // ---------------------------------------------------------------------------
  // Review finding 3 (2.2.1): isOpaqueParams enumerated FormData/Blob/
  // ArrayBuffer/URLSearchParams as though that were the complete set of
  // values whose own enumerable keys don't distinguish them -- but Date, Map
  // and Set have the identical shape: Object.keys() returns [] for all three
  // regardless of content, so stableStringify collapses every one of them to
  // "{}" too. Pre-existing (not a regression from this diff), but the same
  // leak class the predicate exists to close. Map is the example covered
  // here; Date and Set collapse the identical way.
  // ---------------------------------------------------------------------------
  it('never serves one Map-param payload the response to another', async () => {
    const bodies = ['A', 'B']
    let n = 0
    const fetchMock = vi.fn(async () => mockJsonResponse({ who: bodies[n++] }))
    vi.stubGlobal('fetch', fetchMock)

    const cache = cacheMiddleware({ ttl: 60_000, methods: ['POST'] })
    const api = createApi({
      baseUrl: '',
      requests: {
        upload: new Request<Map<string, string>, { who: string }>({ method: 'POST', path: '/upload', middleware: [cache] }),
      },
    })

    const a = new Map([['payload', 'SECRET-A']])
    const b = new Map([['payload', 'SECRET-B']])

    const rA = await api.upload(a)
    const rB = await api.upload(b)

    expect(fetchMock.mock.calls.length).toBe(2)   // B must reach the network
    expect(rA.data).toEqual({ who: 'A' })
    expect(rB.data).toEqual({ who: 'B' })         // never A's cached response
  })

  // ---------------------------------------------------------------------------
  // 4.4.3 (spec 2026-10-03-stable-key-design.md): the key is built by content
  // at every depth, and declines rather than colliding. Before this, every
  // value below the top level whose state lives outside Object.keys() keyed
  // as "{}", so two different requests shared one cache entry.
  // ---------------------------------------------------------------------------
  it('never serves one nested-Date payload the response to another', async () => {
    const bodies = ['A', 'B']
    let n = 0
    const fetchMock = vi.fn(async () => mockJsonResponse({ who: bodies[n++] }))
    vi.stubGlobal('fetch', fetchMock)

    const cache = cacheMiddleware({ ttl: 60_000, methods: ['POST'] })
    const api = createApi({
      baseUrl: '',
      requests: {
        search: new Request<{ since: Date }, { who: string }>({ method: 'POST', path: '/search', middleware: [cache] }),
      },
    })

    const rA = await api.search({ since: new Date('2026-01-01T00:00:00.000Z') })
    const rB = await api.search({ since: new Date('2026-02-01T00:00:00.000Z') })

    expect(fetchMock.mock.calls.length).toBe(2)
    expect(rA.data).toEqual({ who: 'A' })
    expect(rB.data).toEqual({ who: 'B' })
  })

  it('serves identical nested-Date params from cache', async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const cache = cacheMiddleware({ ttl: 60_000, methods: ['POST'] })
    const api = createApi({
      baseUrl: '',
      requests: {
        search: new Request<{ since: Date }, { ok: boolean }>({ method: 'POST', path: '/search', middleware: [cache] }),
      },
    })

    await api.search({ since: new Date('2026-01-01T00:00:00.000Z') })
    await api.search({ since: new Date('2026-01-01T00:00:00.000Z') })

    expect(fetchMock.mock.calls.length).toBe(1)
  })

  it('declines to cache params with hidden state rather than keying them, even when identical', async () => {
    // A class instance keeping its state in a private field has no own
    // enumerable keys, so stableKey cannot see its content and returns null.
    // A BigInt declines the same way. In a POST body it never reaches the
    // middleware chain (JSON.stringify throws at body serialization and the
    // call fails before fetch, roadmap §1.4), but as a GET query param it
    // does: see 'declines to cache a BigInt query param' below.
    class Money {
      #cents: number
      constructor(cents: number) { this.#cents = cents }
      get amount() { return this.#cents / 100 }
    }
    const fetchMock = vi.fn(async () => mockJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const cache = cacheMiddleware({ ttl: 60_000, methods: ['POST'] })
    const api = createApi({
      baseUrl: '',
      requests: {
        quote: new Request<{ price: Money }, { ok: boolean }>({ method: 'POST', path: '/quote', middleware: [cache] }),
      },
    })

    await api.quote({ price: new Money(100) })
    await api.quote({ price: new Money(100) })

    expect(fetchMock.mock.calls.length).toBe(2)
  })

  it('never serves a GET with [1, undefined] the cache entry for [1, null]', async () => {
    // The query string keeps these apart (buildUrl writes array items with
    // String()), so they are different requests and must not share a key.
    const fetchMock = vi.fn(async (_url: string) => mockJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const cache = cacheMiddleware({ ttl: 60_000 })
    const api = createApi({
      baseUrl: 'https://api.example.com',
      requests: {
        items: new Request<{ ids: Array<number | null | undefined> }, { ok: boolean }>({ method: 'GET', path: '/items', middleware: [cache] }),
      },
    })

    await api.items({ ids: [1, null] })
    await api.items({ ids: [1, undefined] })

    expect(fetchMock.mock.calls.length).toBe(2)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/items?ids=1&ids=null')
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.com/items?ids=1&ids=undefined')
  })

  it('declines to cache a BigInt query param, even when identical', async () => {
    const fetchMock = vi.fn(async (_url: string) => mockJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const cache = cacheMiddleware({ ttl: 60_000 })
    const api = createApi({
      baseUrl: 'https://api.example.com',
      requests: {
        get: new Request<{ id: bigint }, { ok: boolean }>({ method: 'GET', path: '/get', middleware: [cache] }),
      },
    })

    await api.get({ id: 10n })
    await api.get({ id: 10n })

    expect(fetchMock.mock.calls.length).toBe(2)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/get?id=10')
  })

  it('treats { a: undefined } and {} as the same key', async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const cache = cacheMiddleware({ ttl: 60_000, methods: ['POST'] })
    const api = createApi({
      baseUrl: '',
      requests: {
        list: new Request<{ a?: string }, { ok: boolean }>({ method: 'POST', path: '/list', middleware: [cache] }),
      },
    })

    await api.list({ a: undefined })
    await api.list({})

    expect(fetchMock.mock.calls.length).toBe(1)
  })

  it('caches identical top-level Map params, keyed by content since 4.4.3', async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const cache = cacheMiddleware({ ttl: 60_000, methods: ['POST'] })
    const api = createApi({
      baseUrl: '',
      requests: {
        upload: new Request<Map<string, string>, { ok: boolean }>({ method: 'POST', path: '/upload', middleware: [cache] }),
      },
    })

    await api.upload(new Map([['payload', 'same']]))
    await api.upload(new Map([['payload', 'same']]))

    expect(fetchMock.mock.calls.length).toBe(1)
  })

  it('keys GraphQL variables by content too: two nested-Date variables are two fetches', async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({ data: { ok: true } }))
    vi.stubGlobal('fetch', fetchMock)

    const cache = cacheMiddleware({ ttl: 60_000, methods: ['POST'] })
    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: {
        since: new Operation<{ since: Date }, { ok: boolean }>({ operation: 'query ($since: String!) { ok(since: $since) }' }),
      },
      middleware: [cache],
    })

    await client.since({ since: new Date('2026-01-01T00:00:00.000Z') })
    await client.since({ since: new Date('2026-02-01T00:00:00.000Z') })
    await client.since({ since: new Date('2026-02-01T00:00:00.000Z') })

    expect(fetchMock.mock.calls.length).toBe(2) // the third call is a hit on the second
  })

  it('declines to cache special-body params at all, rather than keying them wrongly', async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const cache = cacheMiddleware({ ttl: 60_000, methods: ['POST'] })
    const api = createApi({
      baseUrl: '',
      requests: {
        submit: new Request<URLSearchParams, { ok: boolean }>({ method: 'POST', path: '/submit', middleware: [cache] }),
      },
    })

    // The same params twice: still two real requests. Declining to cache is
    // always safe; serving the wrong response never is.
    await api.submit(new URLSearchParams({ q: 'x' }))
    await api.submit(new URLSearchParams({ q: 'x' }))

    expect(fetchMock.mock.calls.length).toBe(2)
  })

  // ---------------------------------------------------------------------------
  // Fix 3 (2.2.1): the guard added for FIXES audit #14 reused isSpecialBody,
  // which also excludes a raw `string` — but stableStringify keys a string
  // correctly (via JSON.stringify), so a string-param endpoint is soundly
  // cacheable. Sharing the predicate with isSpecialBody silently disabled
  // caching for every string-param endpoint in 2.2.0. isOpaqueParams (the
  // four object types only) fixes this without reopening #14: FormData, Blob,
  // ArrayBuffer and URLSearchParams must still decline to cache.
  // ---------------------------------------------------------------------------
  it('caches a string-param endpoint (a raw string is soundly keyable, unlike FormData/Blob/etc)', async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const cache = cacheMiddleware({ ttl: 60_000, methods: ['POST'] })
    // `Request<TParams extends object, ...>` is satisfied by the boxed
    // `String` type (it structurally extends `object`, unlike the lowercase
    // primitive `string`), and a `string` literal is assignable to a
    // `String`-typed parameter — so this is the real, no-cast consumer path
    // for a string-param endpoint, not a type-system workaround.
    const api = createApi({
      baseUrl: '',
      requests: {
        search: new Request<String, { ok: boolean }>({ method: 'POST', path: '/search', middleware: [cache] }),
      },
    })

    await api.search('needle')
    await api.search('needle')

    expect(fetchMock.mock.calls.length).toBe(1) // second call is a cache hit
  })
})

describe('cacheMiddleware key: who asked, and where', () => {
  it('keeps two users apart', async () => {
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) =>
      mockJsonResponse({ who: new Headers(init.headers).get('authorization') }))
    vi.stubGlobal('fetch', fetchMock)
    const me = new Request<Record<string, never>, { who: string }>({ method: 'GET', path: '/me' })
    const api = createApi({ baseUrl: 'https://x.test', requests: { me }, middleware: [cacheMiddleware()] })

    const a = await api.me({}, { headers: { Authorization: 'Bearer A' } })
    const b = await api.me({}, { headers: { Authorization: 'Bearer B' } })

    expect(a.data?.who).toBe('Bearer A')
    expect(b.data?.who).toBe('Bearer B')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps two base URLs apart', async () => {
    const fetchMock = vi.fn(async (url: string) => mockJsonResponse({ url }))
    vi.stubGlobal('fetch', fetchMock)
    const me = new Request<Record<string, never>, { url: string }>({ method: 'GET', path: '/me' })
    const cache = cacheMiddleware()
    const one = createApi({ baseUrl: 'https://one.test', requests: { me }, middleware: [cache] })
    const two = createApi({ baseUrl: 'https://two.test', requests: { me }, middleware: [cache] })

    await one.me()
    const { data } = await two.me()

    expect(data?.url).toBe('https://two.test/me')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('still hits for an identical call', async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const me = new Request<Record<string, never>, unknown>({ method: 'GET', path: '/me' })
    const api = createApi({ baseUrl: 'https://x.test', requests: { me }, middleware: [cacheMiddleware()] })
    await api.me({}, { headers: { Authorization: 'Bearer A' } })
    await api.me({}, { headers: { Authorization: 'Bearer A' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps two GraphQL operations on one endpoint apart', async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({ data: { ok: true } }))
    vi.stubGlobal('fetch', fetchMock)
    const a = new Operation<Record<string, never>, unknown>({ operation: 'query A { a }' })
    const b = new Operation<Record<string, never>, unknown>({ operation: 'query B { b }' })
    const client = createGraphQL({ endpoint: 'https://x.test/graphql', operations: { a, b }, middleware: [cacheMiddleware({ methods: ['POST'] })] })
    await client.a({})
    await client.b({})
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps two base URLs that differ only in their query string apart', async () => {
    const fetchMock = vi.fn(async (url: string) => mockJsonResponse({ url }))
    vi.stubGlobal('fetch', fetchMock)
    const me = new Request<Record<string, never>, { url: string }>({ method: 'GET', path: '/me' })
    const cache = cacheMiddleware()
    const a = createApi({ baseUrl: 'https://x.test?key=A', requests: { me }, middleware: [cache] })
    const b = createApi({ baseUrl: 'https://x.test?key=B', requests: { me }, middleware: [cache] })

    await a.me()
    const { data } = await b.me()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(data?.url).toContain('key=B')
  })

  it('keeps calls apart when a middleware before the cache appends a query parameter', async () => {
    const fetchMock = vi.fn(async (url: string) => mockJsonResponse({ url }))
    vi.stubGlobal('fetch', fetchMock)
    let lang = 'en'
    const addLang = async (ctx: any, next: any) => {
      ctx.request.url += (ctx.request.url.includes('?') ? '&' : '?') + `lang=${lang}`
      return next()
    }
    const me = new Request<Record<string, never>, { url: string }>({ method: 'GET', path: '/me' })
    const api = createApi({ baseUrl: 'https://x.test', requests: { me }, middleware: [addLang, cacheMiddleware()] })

    await api.me()
    lang = 'de'
    const { data } = await api.me()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(data?.url).toContain('lang=de')
  })

  it('still hits when only the order of query pairs differs', async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const me = new Request<Record<string, never>, unknown>({ method: 'GET', path: '/me' })
    const cache = cacheMiddleware()
    const a = createApi({ baseUrl: 'https://x.test?a=1&b=2', requests: { me }, middleware: [cache] })
    const b = createApi({ baseUrl: 'https://x.test?b=2&a=1', requests: { me }, middleware: [cache] })
    await a.me(); await b.me()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keys a query string without URLSearchParams.prototype.sort (React Native polyfill)', async () => {
    const original = URLSearchParams.prototype.sort
    URLSearchParams.prototype.sort = () => { throw new Error('URLSearchParams.sort is not implemented') }
    try {
      const fetchMock = vi.fn(async () => mockJsonResponse({ ok: true }))
      vi.stubGlobal('fetch', fetchMock)
      const me = new Request<Record<string, never>, unknown>({ method: 'GET', path: '/me' })
      const cache = cacheMiddleware()
      const a = createApi({ baseUrl: 'https://x.test?a=1&b=2', requests: { me }, middleware: [cache] })
      const b = createApi({ baseUrl: 'https://x.test?b=2&a=1', requests: { me }, middleware: [cache] })
      const r1 = await a.me(); await b.me()
      expect(r1.error).toBeNull()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      URLSearchParams.prototype.sort = original
    }
  })

  it('still caches when a request-ID middleware runs after the cache', async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    let id = 0
    const requestId = async (ctx: any, next: any) => { ctx.request.headers.set('X-Request-Id', String(id++)); return next() }
    const me = new Request<Record<string, never>, unknown>({ method: 'GET', path: '/me' })
    const api = createApi({ baseUrl: 'https://x.test', requests: { me }, middleware: [cacheMiddleware(), requestId] })
    await api.me(); await api.me()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('misses every time when an outer middleware adds a unique header (documented trade-off)', async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    let id = 0
    const requestId = async (ctx: any, next: any) => { ctx.request.headers.set('X-Request-Id', String(id++)); return next() }
    const me = new Request<Record<string, never>, unknown>({ method: 'GET', path: '/me' })
    const api = createApi({ baseUrl: 'https://x.test', requests: { me }, middleware: [requestId, cacheMiddleware()] })
    await api.me(); await api.me()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('cacheMiddleware defaults (the README option table)', () => {
  const setup = () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => { calls++; return mockJsonResponse({}) })
    const getUser = new Request<{ id: string }, unknown>({ method: 'GET', path: '/users/:id', middleware: [cacheMiddleware()] })
    return { api: createApi({ baseUrl: '', requests: { getUser } }), calls: () => calls }
  }

  it('serves an entry for 5 minutes and not past it', async () => {
    const now = vi.spyOn(Date, 'now')
    const { api, calls } = setup()
    now.mockReturnValue(0)
    await api.getUser({ id: '1' })
    now.mockReturnValue(5 * 60_000 - 1)
    await api.getUser({ id: '1' })
    expect(calls()).toBe(1)
    now.mockReturnValue(5 * 60_000 + 1)
    await api.getUser({ id: '1' })
    expect(calls()).toBe(2)
  })

  it('keeps 50 entries and drops the oldest at the 51st', async () => {
    const { api, calls } = setup()
    for (let i = 0; i < 51; i++) await api.getUser({ id: String(i) })
    expect(calls()).toBe(51)
    await api.getUser({ id: '50' }) // newest, still cached
    expect(calls()).toBe(51)
    await api.getUser({ id: '0' }) // oldest, dropped
    expect(calls()).toBe(52)
  })
})

// ---------------------------------------------------------------------------
// 5.2.0: reads only, unless `methods` says otherwise
// ---------------------------------------------------------------------------

describe('cacheMiddleware caches reads only', () => {
  const json = () => mockJsonResponse({ ok: true })
  const setMethod = (method: string): Middleware => async (ctx, next) => { ctx.request.method = method; return next() }

  it('does not cache a POST by default: two calls, two fetches', async () => {
    const fetchMock = vi.fn(async () => json())
    vi.stubGlobal('fetch', fetchMock)
    const create = new Request<{ name: string }, { ok: boolean }>({ method: 'POST', path: '/orders', middleware: [cacheMiddleware()] })
    const api = createApi({ baseUrl: 'https://x.test', requests: { create } })
    await api.create({ name: 'a' })
    await api.create({ name: 'a' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('still caches a GET by default', async () => {
    const fetchMock = vi.fn(async () => json())
    vi.stubGlobal('fetch', fetchMock)
    const get = new Request<{ id: string }, { ok: boolean }>({ method: 'GET', path: '/orders/:id', middleware: [cacheMiddleware()] })
    const api = createApi({ baseUrl: 'https://x.test', requests: { get } })
    await api.get({ id: '1' })
    await api.get({ id: '1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caches a HEAD by default', async () => {
    const fetchMock = vi.fn(async () => json())
    vi.stubGlobal('fetch', fetchMock)
    const head = new Request<{ id: string }, { ok: boolean }>({ method: 'GET', path: '/orders/:id', middleware: [setMethod('HEAD'), cacheMiddleware()] })
    const api = createApi({ baseUrl: 'https://x.test', requests: { head } })
    await api.head({ id: '1' })
    await api.head({ id: '1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("caches a POST when methods lists it, compared without regard to case", async () => {
    const fetchMock = vi.fn(async () => json())
    vi.stubGlobal('fetch', fetchMock)
    const search = new Request<{ q: string }, { ok: boolean }>({ method: 'POST', path: '/search', middleware: [cacheMiddleware({ methods: ['post'] })] })
    const api = createApi({ baseUrl: 'https://x.test', requests: { search } })
    await api.search({ q: 'lamp' })
    await api.search({ q: 'lamp' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('methods: [] caches nothing', async () => {
    const fetchMock = vi.fn(async () => json())
    vi.stubGlobal('fetch', fetchMock)
    const get = new Request<{ id: string }, { ok: boolean }>({ method: 'GET', path: '/orders/:id', middleware: [cacheMiddleware({ methods: [] })] })
    const api = createApi({ baseUrl: 'https://x.test', requests: { get } })
    await api.get({ id: '1' })
    await api.get({ id: '1' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('compares the method as a middleware outside the cache left it', async () => {
    const fetchMock = vi.fn(async () => json())
    vi.stubGlobal('fetch', fetchMock)
    const get = new Request<{ id: string }, { ok: boolean }>({ method: 'GET', path: '/orders/:id', middleware: [setMethod('POST'), cacheMiddleware()] })
    const api = createApi({ baseUrl: 'https://x.test', requests: { get } })
    await api.get({ id: '1' })
    await api.get({ id: '1' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a method it skips never touches the store: no debug line', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json()))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const create = new Request<{ name: string }, { ok: boolean }>({ method: 'POST', path: '/orders', middleware: [cacheMiddleware({ debug: true })] })
    const api = createApi({ baseUrl: 'https://x.test', requests: { create } })
    await api.create({ name: 'a' })
    expect(log).not.toHaveBeenCalled()
  })

  it('a methods value that is not an array (plain JS) falls back to the default instead of throwing', async () => {
    const fetchMock = vi.fn(async () => json())
    vi.stubGlobal('fetch', fetchMock)
    const get = new Request<{ id: string }, { ok: boolean }>({ method: 'GET', path: '/orders/:id', middleware: [cacheMiddleware({ methods: 'POST' as never })] })
    const api = createApi({ baseUrl: 'https://x.test', requests: { get } })
    await api.get({ id: '1' })
    await api.get({ id: '1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('GraphQL: an operation under the default cache never hits, since every operation is a POST', async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({ data: { ok: true } }))
    vi.stubGlobal('fetch', fetchMock)
    const ok = new Operation<Record<string, never>, { ok: boolean }>({ operation: 'query { ok }', middleware: [cacheMiddleware()] })
    const client = createGraphQL({ endpoint: 'https://x.test/graphql', operations: { ok } })
    await client.ok()
    await client.ok()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("GraphQL: methods: ['POST'] on a query operation caches it", async () => {
    const fetchMock = vi.fn(async () => mockJsonResponse({ data: { ok: true } }))
    vi.stubGlobal('fetch', fetchMock)
    const ok = new Operation<Record<string, never>, { ok: boolean }>({ operation: 'query { ok }', middleware: [cacheMiddleware({ methods: ['POST'] })] })
    const client = createGraphQL({ endpoint: 'https://x.test/graphql', operations: { ok } })
    await client.ok()
    await client.ok()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('the cache key includes the fetch options (5.2.0)', () => {
  const json = () => mockJsonResponse({ ok: true })
  const get = () => new Request<{ id: string }, { ok: boolean }>({ method: 'GET', path: '/orders/:id', middleware: [cacheMiddleware()] })

  it('calls that differ only in credentials get separate entries', async () => {
    const fetchMock = vi.fn(async () => json())
    vi.stubGlobal('fetch', fetchMock)
    const api = createApi({ baseUrl: 'https://x.test', requests: { order: get() } })
    await api.order({ id: '1' }, { fetchOptions: { credentials: 'include' } })
    await api.order({ id: '1' }, { fetchOptions: { credentials: 'omit' } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('the same options in a different key order are one entry', async () => {
    const fetchMock = vi.fn(async () => json())
    vi.stubGlobal('fetch', fetchMock)
    const api = createApi({ baseUrl: 'https://x.test', requests: { order: get() } })
    await api.order({ id: '1' }, { fetchOptions: { credentials: 'include', mode: 'cors' } })
    await api.order({ id: '1' }, { fetchOptions: { mode: 'cors', credentials: 'include' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // The final review's probe: two undici Agents with different client
  // certificates keyed alike by content, so tenant B got tenant A's response.
  class Agent {
    _events = {}
    #cert: string
    constructor(cert: string) { this.#cert = cert }
    cert() { return this.#cert }
  }

  it('two agents that look alike are two entries: an object that is not plain compares by identity', async () => {
    const fetchMock = vi.fn(async () => json())
    vi.stubGlobal('fetch', fetchMock)
    const api = createApi({ baseUrl: 'https://x.test', requests: { order: get() } })
    await api.order({ id: '1' }, { fetchOptions: { dispatcher: new Agent('tenant-a') } as unknown as FetchOptions })
    await api.order({ id: '1' }, { fetchOptions: { dispatcher: new Agent('tenant-b') } as unknown as FetchOptions })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('the same agent object reused across calls is one entry', async () => {
    const fetchMock = vi.fn(async () => json())
    vi.stubGlobal('fetch', fetchMock)
    const agent = new Agent('tenant-a')
    const api = createApi({ baseUrl: 'https://x.test', requests: { order: get() } })
    await api.order({ id: '1' }, { fetchOptions: { dispatcher: agent } as unknown as FetchOptions })
    await api.order({ id: '1' }, { fetchOptions: { dispatcher: agent } as unknown as FetchOptions })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a plain nested object compares by content: key order does not matter, a value does', async () => {
    const fetchMock = vi.fn(async () => json())
    vi.stubGlobal('fetch', fetchMock)
    const api = createApi({ baseUrl: 'https://x.test', requests: { order: get() } })
    const next = (value: unknown) => ({ next: value }) as unknown as FetchOptions
    await api.order({ id: '1' }, { fetchOptions: next({ revalidate: 60, tags: ['orders'] }) })
    await api.order({ id: '1' }, { fetchOptions: next({ tags: ['orders'], revalidate: 60 }) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await api.order({ id: '1' }, { fetchOptions: next({ revalidate: 30, tags: ['orders'] }) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a stray signal and method (plain JS) are not keyed: the options are keyed as they are sent', async () => {
    const fetchMock = vi.fn(async () => json())
    vi.stubGlobal('fetch', fetchMock)
    const api = createApi({ baseUrl: 'https://x.test', requests: { order: get() } })
    const stray = (method: string) =>
      ({ credentials: 'include', method, signal: new AbortController().signal }) as unknown as FetchOptions
    await api.order({ id: '1' }, { fetchOptions: stray('POST') })
    await api.order({ id: '1' }, { fetchOptions: stray('DELETE') })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('options it cannot key are declined: neither served nor stored', async () => {
    const fetchMock = vi.fn(async () => json())
    vi.stubGlobal('fetch', fetchMock)
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const opaque = { next: circular } as unknown as FetchOptions
    const api = createApi({ baseUrl: 'https://x.test', requests: { order: get() } })
    await api.order({ id: '1' }, { fetchOptions: opaque })
    await api.order({ id: '1' }, { fetchOptions: opaque })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe("the cache key includes a client's own fetch", () => {
  const fetchAs = (name: string) => vi.fn(async () => mockJsonResponse({ user: name }))
  const me = () => new Request<Record<string, never>, { user: string }>({ method: 'GET', path: '/me', middleware: [cacheMiddleware()] })

  it('two clients with different fetch functions never share an entry through one endpoint', async () => {
    const getMe = me()
    const fa = fetchAs('alice')
    const fb = fetchAs('bob')
    const alice = createApi({ baseUrl: 'https://x.test', requests: { getMe }, fetch: fa as unknown as typeof fetch })
    const bob = createApi({ baseUrl: 'https://x.test', requests: { getMe }, fetch: fb as unknown as typeof fetch })
    const users: unknown[] = []
    for (const c of [alice, bob, alice, bob]) {
      const r = await c.getMe()
      users.push(r.data?.user)
    }
    expect(users).toEqual(['alice', 'bob', 'alice', 'bob'])
    expect(fa).toHaveBeenCalledTimes(1)
    expect(fb).toHaveBeenCalledTimes(1)
  })

  it('two clients on the global fetch share an endpoint cache, as before', async () => {
    const getMe = me()
    const fetchMock = fetchAs('x')
    vi.stubGlobal('fetch', fetchMock)
    const one = createApi({ baseUrl: 'https://x.test', requests: { getMe } })
    const two = createApi({ baseUrl: 'https://x.test', requests: { getMe } })
    await one.getMe()
    await two.getMe()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('two clients given the same fetch function share entries', async () => {
    const getMe = me()
    const f = fetchAs('x')
    const one = createApi({ baseUrl: 'https://x.test', requests: { getMe }, fetch: f as unknown as typeof fetch })
    const two = createApi({ baseUrl: 'https://x.test', requests: { getMe }, fetch: f as unknown as typeof fetch })
    await one.getMe()
    await two.getMe()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('GraphQL: clients with different fetch functions never share an entry', async () => {
    const who = new Operation<Record<string, never>, { user: string }>({ operation: 'query { user }', middleware: [cacheMiddleware({ methods: ['POST'] })] })
    const gql = (name: string) => vi.fn(async () => mockJsonResponse({ data: { user: name } }))
    const fa = gql('alice')
    const fb = gql('bob')
    const alice = createGraphQL({ endpoint: 'https://x.test/graphql', operations: { who }, fetch: fa as unknown as typeof fetch })
    const bob = createGraphQL({ endpoint: 'https://x.test/graphql', operations: { who }, fetch: fb as unknown as typeof fetch })
    const users: unknown[] = []
    for (const c of [alice, bob, alice, bob]) {
      const r = await c.who()
      users.push(r.data?.user)
    }
    expect(users).toEqual(['alice', 'bob', 'alice', 'bob'])
    expect(fa).toHaveBeenCalledTimes(1)
    expect(fb).toHaveBeenCalledTimes(1)
  })

  it('the stamp is invisible to a middleware that spreads or logs ctx, but readable', async () => {
    const f = fetchAs('x') as unknown as typeof fetch
    let seen: Parameters<Middleware>[0] | undefined
    const capture: Middleware = (ctx, next) => {
      seen = ctx
      return next()
    }
    const getMe = new Request<Record<string, never>, { user: string }>({ method: 'GET', path: '/me', middleware: [capture] })
    const api = createApi({ baseUrl: 'https://x.test', requests: { getMe }, fetch: f })
    await api.getMe()
    expect(seen).toBeDefined()
    expect(Object.keys(seen!)).toEqual(['request', 'requestName'])
    expect(JSON.stringify(seen)).not.toContain('clientFetch')
    expect(Object.keys({ ...seen })).toEqual(['request', 'requestName'])
    expect(clientFetchOf(seen!)).toBe(f)
  })
})
