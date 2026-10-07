import { describe, it, expect, afterEach, vi } from 'vitest'
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

type Api = ReturnType<typeof makeApi>
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

describe('withHeaders: values are fixed when the copy is made', () => {
  it('mutating the headers object afterwards changes nothing the copy sends', async () => {
    serve()
    const headers: Record<string, string> = { cookie: 's=alice' }
    const copy = withHeaders(makeApi(), headers)
    headers.cookie = 's=bob'
    headers['X-Late'] = '1'
    await copy.me()
    expect([header(0, 'cookie'), header(0, 'x-late')]).toEqual(['s=alice', null])
    expect(copy.me.getHeaders().cookie).toBe('s=alice')
  })

  it('a Headers instance filled in after the copy is made adds nothing', async () => {
    serve()
    const headers = new Headers()
    const copy = withHeaders(makeApi(), headers)
    headers.set('cookie', 's=bob')
    await copy.me()
    expect(header(0, 'cookie')).toBeNull()
    expect(copy.me.getHeaders().cookie).toBeUndefined()
  })

  it('a getter is read once, when the copy is made', async () => {
    serve()
    let reads = 0
    const copy = withHeaders(makeApi(), { get cookie() { return `s=${++reads}` } })
    await copy.me()
    await copy.me()
    copy.me.getHeaders()
    expect(reads).toBe(1)
    expect([header(0, 'cookie'), header(1, 'cookie')]).toEqual(['s=1', 's=1'])
  })
})

describe('withHeaders: never throws', () => {
  it("an invalid header value: every call is a 'network' Result, getHeaders() is {}, nothing is sent", async () => {
    serve()
    const api = makeApi()
    let copy!: typeof api
    expect(() => { copy = withHeaders(api, { 'X-Bad': 'a\nb' }) }).not.toThrow()
    const result = await copy.me()
    expect(result.error?.kind).toBe('network')
    expect(result.error?.body).toBeInstanceOf(TypeError)
    expect(copy.me.getHeaders()).toEqual({})
    expect(mock.calls).toHaveLength(0)
  })

  it("something that isn't a client gets a stand-in whose calls are 'network' Results", async () => {
    const junk = withHeaders({} as ReturnType<typeof makeApi>, { cookie: 'x' })
    const result = await junk.me()
    expect(result.error?.kind).toBe('network')
    expect(String(result.error?.body)).toMatch(/isn't a client from createApi or createGraphQL/)
    const deeper = await (junk as unknown as { query: { who: () => Promise<{ error: { kind: string } }> } }).query.who()
    expect(deeper.error.kind).toBe('network')
  })

  it('the stand-in is not a promise, so awaiting it resolves', async () => {
    const junk = withHeaders(null as unknown as ReturnType<typeof makeApi>, {})
    await expect(Promise.race([
      Promise.resolve(junk).then(() => 'resolved'),
      new Promise(r => setTimeout(() => r('hung'), 50)),
    ])).resolves.toBe('resolved')
  })

  const revoked = () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    return proxy
  }
  const hostile: [string, () => unknown][] = [
    ['a revoked Proxy as the client', () => withHeaders(revoked() as Api, { cookie: 'x' })],
    ['a client whose copy stamp is a throwing getter', () => withHeaders(
      Object.defineProperty({}, Symbol.for('liaise.copy'), { get() { throw new Error('boom') } }) as Api, { cookie: 'x' })],
    ['a Proxy that throws on unknown keys', () => withHeaders(new Proxy({}, {
      get(target, key) { if (!(key in target)) throw new Error(`no ${String(key)}`); return Reflect.get(target, key) },
    }) as Api, { cookie: 'x' })],
    ['options whose dedupe getter throws', () => withHeaders(makeApi(), { cookie: 'x' }, { get dedupe(): boolean { throw new Error('boom') } })],
    ['a revoked Proxy as options', () => withHeaders(makeApi(), { cookie: 'x' }, revoked())],
  ]
  it.each(hostile)("%s: a stand-in whose calls are 'network' Results, and nothing is sent", async (_, make) => {
    serve()
    let copy!: Api
    expect(() => { copy = make() as Api }).not.toThrow()
    expect((await copy.me()).error?.kind).toBe('network')
    expect(mock.calls).toHaveLength(0)
  })

  it('the stand-in prints as a string, and getHeaders() at any depth is {}, at once', () => {
    const junk = withHeaders({} as Api, { cookie: 'x' })
    expect(() => [String(junk), `${junk.me}`, String((junk as unknown as { query: { who: unknown } }).query.who)]).not.toThrow()
    expect(String(junk)).toMatch(/isn't a client/)
    expect(junk.me.getHeaders()).toEqual({})
    const deep = junk as unknown as { query: { who: { getHeaders(): unknown } } }
    expect(deep.query.who.getHeaders()).toEqual({})
    expect(deep.query.who.getHeaders()).not.toBeInstanceOf(Promise)
  })

  it('the stand-in has no then and no symbol keys, at any depth', () => {
    const junk = withHeaders({} as Api, { cookie: 'x' }) as unknown as Record<string | symbol, Record<string | symbol, unknown>>
    // typeof, so a failure prints a word: printing the stand-in itself could throw.
    for (const node of [junk, junk.me]) {
      expect(typeof node.then).toBe('undefined')
      expect(typeof node[Symbol.toPrimitive]).toBe('undefined')
      expect(typeof node[Symbol.iterator]).toBe('undefined')
    }
  })

  it('a spread client gets the stand-in, and its message says why', async () => {
    const api = makeApi()
    const spread = withHeaders({ ...api } as typeof api, { cookie: 'x' })
    const result = await spread.me()
    expect(result.error?.kind).toBe('network')
    expect(String(result.error?.body)).toMatch(/spread/)
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

describe("withHeaders: everything else is the client's", () => {
  const setup = () => {
    const own = mockFetch({ 'GET /me': () => jsonResponse({ cookie: null }), 'GET /slow': async () => { await new Promise(r => setTimeout(r, 200)); return jsonResponse({ cookie: null }) } })
    const onError = vi.fn()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const api = createApi({
      baseUrl: 'https://api.test',
      fetch: own.fetch,
      fetchOptions: { credentials: 'include' },
      timeout: 20,
      onError,
      log: true,
      requests: {
        me: defineRequest<Me>()({ method: 'GET', path: '/me' }),
        slow: defineRequest<Me>()({ method: 'GET', path: '/slow' }),
      },
    })
    return { own, onError, spy, user: withHeaders(api, { cookie: 's=1' }) }
  }
  afterEach(() => vi.restoreAllMocks())

  it("sends through the client's own fetch, with its fetchOptions, and the global fetch is untouched", async () => {
    const { own, user } = setup()
    const global = vi.fn(async () => { throw new TypeError('the global fetch was used') })
    vi.stubGlobal('fetch', global)
    try {
      const { error } = await user.me()
      expect(error).toBeNull()
      expect(own.calls).toHaveLength(1)
      expect(own.calls[0].headers.get('cookie')).toBe('s=1')
      expect(own.calls[0].init.credentials).toBe('include')
      expect(global).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it("applies the client's timeout and reports through its onError", async () => {
    const { onError, user } = setup()
    const { error } = await user.slow()
    expect(error?.kind).toBe('timeout')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0].kind).toBe('timeout')
  })

  it("logs the copy's call with the client's log", async () => {
    const { spy, user } = setup()
    await user.me()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[0][0]).toBe('[liaise] → GET me https://api.test/me')
    expect(spy.mock.calls[1][0]).toMatch(/^\[liaise\] ← me OK/)
  })
})
