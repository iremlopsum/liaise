import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApi, defineRequest, createGraphQL, Operation, pollUntil } from '../src/index.js'
import { mockFetch, jsonResponse } from '../src/testing.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const flush = () => new Promise<void>(r => setTimeout(r, 0))
const ok = () => new Response(JSON.stringify({ id: '1', name: 'Ada' }), { status: 200, headers: { 'content-type': 'application/json' } })
const gqlOk = () => new Response(JSON.stringify({ data: { viewer: { id: '1' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
/** The global fetch, set to fail loudly: a test that reaches it has used the wrong fetch. */
const forbidGlobal = () => {
  const global = vi.fn(async () => { throw new TypeError('the global fetch was used') })
  vi.stubGlobal('fetch', global)
  return global
}

const getUser = defineRequest<{ id: string; name: string }>()({ method: 'GET', path: '/users/:id' })
const viewer = new Operation<Record<string, never>, { viewer: { id: string } }>({ operation: 'query { viewer { id } }' })

describe('createApi({ fetch })', () => {
  it('sends with the given fetch and never touches the global', async () => {
    const global = forbidGlobal()
    const own = vi.fn(async (_url: string, _init: RequestInit) => ok())
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser }, fetch: own })
    const { data } = await api.getUser({ id: '1' })
    expect(data).toEqual({ id: '1', name: 'Ada' })
    expect(own).toHaveBeenCalledTimes(1)
    expect(own.mock.calls[0][0]).toBe('https://x.test/users/1')
    expect(global).not.toHaveBeenCalled()
  })

  it('without it, looks up the global fetch on every call, so a stub installed after the client is built is used', async () => {
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser } })
    const later = vi.fn(async () => ok())
    vi.stubGlobal('fetch', later)
    await api.getUser({ id: '1' })
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('calls it unbound, so a fetch that refuses a foreign `this` (like window.fetch) works', async () => {
    function strict(this: unknown, _url: string, _init: RequestInit): Promise<Response> {
      if (this !== undefined) return Promise.reject(new TypeError('Illegal invocation'))
      return Promise.resolve(ok())
    }
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser }, fetch: strict })
    const { data, error } = await api.getUser({ id: '1' })
    expect(error).toBeNull()
    expect(data?.name).toBe('Ada')
  })

  it('a fetch that throws synchronously gives a network Result, never a throw', async () => {
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser }, fetch: () => { throw new TypeError('boom') } })
    const { error } = await api.getUser({ id: '1' })
    expect(error?.kind).toBe('network')
    expect(String(error?.body)).toContain('boom')
  })

  it('a fetch that rejects gives a network Result', async () => {
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser }, fetch: async () => { throw new TypeError('offline') } })
    expect((await api.getUser({ id: '1' })).error?.kind).toBe('network')
  })

  it('a value that is not a function is a network Result on each call, not a throw when the client is built', async () => {
    forbidGlobal()
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser }, fetch: 'nope' as never })
    const { error } = await api.getUser({ id: '1' })
    expect(error?.kind).toBe('network')
    expect(String(error?.body)).not.toContain('the global fetch was used')
  })

  it('a fetch that never settles and ignores the signal still ends at the timeout', async () => {
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser }, timeout: 20, fetch: () => new Promise<Response>(() => {}) })
    expect((await api.getUser({ id: '1' })).error?.kind).toBe('timeout')
  })

  it('under dedupe, the superseded call is an abort and the newer one succeeds, each with its own signal', async () => {
    const signals: AbortSignal[] = []
    const own = (_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      const signal = init.signal!
      signals.push(signal)
      signal.addEventListener('abort', () => reject(signal.reason))
      setTimeout(() => resolve(ok()), 10)
    })
    const latest = defineRequest<{ id: string; name: string }>()({ method: 'GET', path: '/users/:id', dedupe: true })
    const api = createApi({ baseUrl: 'https://x.test', requests: { latest }, fetch: own })
    const first = api.latest({ id: '1' })
    await flush()
    const second = api.latest({ id: '1' })
    expect((await first).error?.kind).toBe('abort')
    expect((await second).error).toBeNull()
    expect(signals).toHaveLength(2)
    expect(signals[0]).not.toBe(signals[1])
  })

  it('shared calls go through it: two identical share calls, one request', async () => {
    forbidGlobal()
    const own = vi.fn(async () => ok())
    const shared = defineRequest<{ id: string; name: string }>()({ method: 'GET', path: '/users/:id', share: true })
    const api = createApi({ baseUrl: 'https://x.test', requests: { shared }, fetch: own })
    const [a, b] = await Promise.all([api.shared({ id: '1' }), api.shared({ id: '1' })])
    expect(a.error).toBeNull()
    expect(b.error).toBeNull()
    expect(own).toHaveBeenCalledTimes(1)
  })

  it('polled calls go through it', async () => {
    forbidGlobal()
    const own = vi.fn(async () => ok())
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser }, fetch: own })
    const r = await pollUntil(api.getUser, { id: '1' }, { every: 1000, until: () => true })
    expect(r.data?.name).toBe('Ada')
    expect(own).toHaveBeenCalledTimes(1)
  })

  it('mockFetch().fetch plugs in without install()', async () => {
    forbidGlobal()
    const mock = mockFetch({ 'GET /users/:id': jsonResponse({ id: '1', name: 'Ada' }) })
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser }, fetch: mock.fetch })
    expect((await api.getUser({ id: '1' })).data?.name).toBe('Ada')
    expect(mock.callCount('GET /users/:id')).toBe(1)
  })
})

describe('createGraphQL({ fetch })', () => {
  it('sends with the given fetch and never touches the global', async () => {
    const global = forbidGlobal()
    const own = vi.fn(async (_url: string, _init: RequestInit) => gqlOk())
    const client = createGraphQL({ endpoint: 'https://x.test/graphql', operations: { viewer }, fetch: own })
    expect((await client.viewer()).data).toEqual({ viewer: { id: '1' } })
    expect(own).toHaveBeenCalledTimes(1)
    expect(global).not.toHaveBeenCalled()
  })

  it('calls it unbound', async () => {
    function strict(this: unknown): Promise<Response> {
      if (this !== undefined) return Promise.reject(new TypeError('Illegal invocation'))
      return Promise.resolve(gqlOk())
    }
    const client = createGraphQL({ endpoint: 'https://x.test/graphql', operations: { viewer }, fetch: strict })
    expect((await client.viewer()).error).toBeNull()
  })

  it('a fetch that throws synchronously gives a network Result', async () => {
    const client = createGraphQL({ endpoint: 'https://x.test/graphql', operations: { viewer }, fetch: () => { throw new TypeError('boom') } })
    expect((await client.viewer()).error?.kind).toBe('network')
  })

  it('shared operations go through it', async () => {
    forbidGlobal()
    const own = vi.fn(async () => gqlOk())
    const sharedViewer = new Operation<Record<string, never>, { viewer: { id: string } }>({ operation: 'query { viewer { id } }', share: true })
    const client = createGraphQL({ endpoint: 'https://x.test/graphql', operations: { sharedViewer }, fetch: own })
    const [a, b] = await Promise.all([client.sharedViewer(), client.sharedViewer()])
    expect(a.error).toBeNull()
    expect(b.error).toBeNull()
    expect(own).toHaveBeenCalledTimes(1)
  })
})
