import { describe, it, expect, afterEach } from 'vitest'
import { createApi, defineRequest, paginate, withHeaders } from '../src/index.js'
import { cacheMiddleware } from '../src/built-in-middleware.js'
import { mockFetch, jsonResponse } from '../src/testing.js'

type Me = { cookie: string | null }
let mock: ReturnType<typeof mockFetch>
afterEach(() => mock?.restore())

/** GET /me and GET /search answer after `ms` with the cookie they got. GET /pages pages twice. */
function serve(ms = 0) {
  const answer = async ({ request }: { request: { headers: Headers } }) => {
    if (ms) await new Promise(r => setTimeout(r, ms))
    return jsonResponse({ cookie: request.headers.get('cookie') })
  }
  mock = mockFetch({
    'GET /me': answer,
    'GET /search': answer,
    'GET /pages': ({ request }) => {
      const page = new URL(request.url).searchParams.get('page')
      return jsonResponse({ page: Number(page), next: page === '1' ? 2 : null })
    },
  })
  mock.install()
}

function makeApi(extra: { dedupe?: boolean; share?: boolean } = {}) {
  return createApi({
    baseUrl: 'https://api.test',
    headers: { 'X-Layer': 'client', 'X-Client': 'web', Authorization: 'Bearer app' },
    requests: {
      me: defineRequest<Me>()({ method: 'GET', path: '/me', share: extra.share }),
      pinned: defineRequest<Me>()({ method: 'GET', path: '/me', headers: { 'X-Layer': 'endpoint' } }),
      search: defineRequest<Me, { q: string }>()({ method: 'GET', path: '/search', dedupe: extra.dedupe }),
      pages: defineRequest<{ page: number; next: number | null }, { page: number }>()({ method: 'GET', path: '/pages' }),
    },
  })
}

const header = (i: number, name: string) => mock.calls[i].headers.get(name)

describe('withHeaders: headers', () => {
  it("sends the copy's headers; the original sends none of them", async () => {
    serve()
    const api = makeApi()
    const copy = withHeaders(api, { cookie: 's=alice' })
    await copy.me()
    await api.me()
    expect(header(0, 'cookie')).toBe('s=alice')
    expect(header(1, 'cookie')).toBeNull()
  })

  it('ranks the copy as a client header: client < copy < endpoint < call', async () => {
    serve()
    const copy = withHeaders(makeApi(), { 'X-Layer': 'copy', 'X-Copy': '1' })
    await copy.me()
    await copy.pinned()
    await copy.me({}, { headers: { 'X-Layer': 'call' } })
    expect([0, 1, 2].map(i => header(i, 'x-layer'))).toEqual(['copy', 'endpoint', 'call'])
    expect(header(0, 'x-client')).toBe('web')
    expect(header(1, 'x-copy')).toBe('1')
  })

  it("a copy's header replaces the client's whatever the case", async () => {
    serve()
    const copy = withHeaders(makeApi(), { authorization: 'Bearer alice' })
    await copy.me()
    expect(header(0, 'authorization')).toBe('Bearer alice')
    expect(copy.me.getHeaders()).toEqual({ authorization: 'Bearer alice', 'x-client': 'web', 'x-layer': 'client' })
  })

  it('copies chain, the later layer winning', async () => {
    serve()
    const copy = withHeaders(withHeaders(makeApi(), { 'X-A': '1', 'X-B': '1' }), { 'X-B': '2' })
    await copy.me()
    expect([header(0, 'x-a'), header(0, 'x-b')]).toEqual(['1', '2'])
  })

  it('getHeaders() on a chained copy has every layer, the later winning', () => {
    const copy = withHeaders(withHeaders(makeApi(), { 'X-A': '1', 'X-B': '1' }), { 'X-B': '2' })
    expect(copy.me.getHeaders()).toEqual({ authorization: 'Bearer app', 'x-a': '1', 'x-b': '2', 'x-client': 'web', 'x-layer': 'client' })
  })

  it('takes every HeadersInit shape', async () => {
    serve()
    const api = makeApi()
    await withHeaders(api, new Headers({ cookie: 's=h' })).me()
    await withHeaders(api, [['cookie', 's=t']]).me()
    expect([header(0, 'cookie'), header(1, 'cookie')]).toEqual(['s=h', 's=t'])
  })

  it("getHeaders() on a copy shows its headers, under the endpoint's own", () => {
    const api = makeApi()
    const copy = withHeaders(api, { 'X-Layer': 'copy', cookie: 's=1' })
    expect(copy.me.getHeaders()).toEqual({ authorization: 'Bearer app', cookie: 's=1', 'x-client': 'web', 'x-layer': 'copy' })
    expect(copy.pinned.getHeaders()['x-layer']).toBe('endpoint')
    expect(api.me.getHeaders().cookie).toBeUndefined()
  })

  it("retry() keeps the copy's headers", async () => {
    serve()
    const result = await withHeaders(makeApi(), { cookie: 's=alice' }).me()
    await result.retry()
    expect([header(0, 'cookie'), header(1, 'cookie')]).toEqual(['s=alice', 's=alice'])
  })

  it('paginate over a copy sends its headers on every page', async () => {
    serve()
    const copy = withHeaders(makeApi(), { cookie: 's=alice' })
    const pages = []
    for await (const page of paginate(copy.pages, { page: 1 }, { next: p => (p.data.next ? { page: p.data.next } : null) })) pages.push(page)
    expect(pages).toHaveLength(2)
    expect([header(0, 'cookie'), header(1, 'cookie')]).toEqual(['s=alice', 's=alice'])
  })

  it('the copy has every endpoint and no others', () => {
    const api = makeApi()
    expect(Object.keys(withHeaders(api, { cookie: 'x' }))).toEqual(Object.keys(api))
  })
})

describe('withHeaders: dedupe', () => {
  it('copies that add the same headers share a lane: a new copy per keystroke still cancels the stale call', async () => {
    serve(20)
    const api = makeApi({ dedupe: true })
    const first = withHeaders(api, { cookie: 's=alice' }).search({ q: 'a' })
    const second = withHeaders(api, { Cookie: 's=alice' }).search({ q: 'ab' })
    expect((await first).error?.kind).toBe('abort')
    expect((await second).data?.cookie).toBe('s=alice')
  })

  it("copies with different headers never cancel each other's calls", async () => {
    serve(20)
    const api = makeApi({ dedupe: true })
    const alice = withHeaders(api, { cookie: 's=alice' }).search({ q: 'a' })
    const bob = withHeaders(api, { cookie: 's=bob' }).search({ q: 'b' })
    expect((await alice).data?.cookie).toBe('s=alice')
    expect((await bob).data?.cookie).toBe('s=bob')
  })

  it("a copy that adds nothing shares the original's lane; one that adds headers doesn't", async () => {
    serve(20)
    const api = makeApi({ dedupe: true })
    const original = api.search({ q: 'a' })
    const same = withHeaders(api, {}).search({ q: 'b' })
    const other = withHeaders(api, { cookie: 's=1' }).search({ q: 'c' })
    expect((await original).error?.kind).toBe('abort')
    expect((await same).error).toBeNull()
    expect((await other).error).toBeNull()
  })

  it('{ dedupe: false }: calls through the copy neither cancel nor get cancelled', async () => {
    serve(20)
    const api = makeApi({ dedupe: true })
    const on = withHeaders(api, { cookie: 's=alice' })
    const off = withHeaders(api, { cookie: 's=alice' }, { dedupe: false })
    const a = on.search({ q: '1' })
    const b = off.search({ q: '2' })
    const c = off.search({ q: '3' })
    const d = on.search({ q: '4' })
    expect((await a).error?.kind).toBe('abort')
    expect((await b).error).toBeNull()
    expect((await c).error).toBeNull()
    expect((await d).error).toBeNull()
  })

  it('{ dedupe: false }: a later call through the copy does not cancel an earlier one through an on copy', async () => {
    serve(20)
    const api = makeApi({ dedupe: true })
    const on = withHeaders(api, { cookie: 's=alice' })
    const off = withHeaders(api, { cookie: 's=alice' }, { dedupe: false })
    const a = on.search({ q: '1' })
    const b = off.search({ q: '2' })
    expect((await a).error).toBeNull()
    expect((await b).error).toBeNull()
  })

  it('a copy of a copy inherits dedupe: false, and dedupe: true turns it back on', async () => {
    serve(20)
    const off = withHeaders(makeApi({ dedupe: true }), { cookie: 's=1' }, { dedupe: false })
    const inherited = withHeaders(off, { 'X-More': '1' })
    const a = inherited.search({ q: '1' })
    const b = inherited.search({ q: '2' })
    expect((await a).error).toBeNull()
    expect((await b).error).toBeNull()
    const on = withHeaders(off, { 'X-More': '1' }, { dedupe: true })
    const c = on.search({ q: '3' })
    const d = on.search({ q: '4' })
    expect((await c).error?.kind).toBe('abort')
    expect((await d).error).toBeNull()
  })
})

describe('withHeaders: share and cache stay safe', () => {
  it('two copies for one user share one request; alice and bob never do', async () => {
    serve(20)
    const api = makeApi({ share: true })
    const [a1, a2, b] = await Promise.all([
      withHeaders(api, { cookie: 's=alice' }).me(),
      withHeaders(api, { cookie: 's=alice' }).me(),
      withHeaders(api, { cookie: 's=bob' }).me(),
    ])
    expect(mock.callCount('GET /me')).toBe(2)
    expect([a1.data?.cookie, a2.data?.cookie, b.data?.cookie]).toEqual(['s=alice', 's=alice', 's=bob'])
  })

  it("one cacheMiddleware never serves alice's entry to bob", async () => {
    serve()
    const cache = cacheMiddleware({ ttl: 60_000 })
    const api = createApi({
      baseUrl: 'https://api.test',
      requests: { me: defineRequest<Me>()({ method: 'GET', path: '/me', middleware: [cache] }) },
    })
    expect((await withHeaders(api, { cookie: 's=alice' }).me()).data?.cookie).toBe('s=alice')
    expect((await withHeaders(api, { cookie: 's=bob' }).me()).data?.cookie).toBe('s=bob')
    expect((await withHeaders(api, { cookie: 's=alice' }).me()).data?.cookie).toBe('s=alice')
    expect(mock.callCount('GET /me')).toBe(2)
  })
})
