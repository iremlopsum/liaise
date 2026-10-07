import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApi, defineRequest, paginate, poll } from '../src/index.js'
import type { FetchOptions, Middleware } from '../src/index.js'
import { retryMiddleware } from '../src/built-in-middleware.js'
import { mergeFetchOptions, sendableFetchOptions } from '../src/utils/fetch-options.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const flush = () => new Promise<void>(r => setTimeout(r, 0))
const json = (body: unknown = { ok: true }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A global fetch that records every init it receives. */
function recorder(respond: () => Response = () => json()) {
  const inits: RequestInit[] = []
  const fetch = vi.fn(async (_url: string, init: RequestInit) => { inits.push(init); return respond() })
  vi.stubGlobal('fetch', fetch)
  return { fetch, inits }
}

/** A global fetch whose answers wait until released, so concurrent calls overlap. */
function gated() {
  const waiting: Array<() => void> = []
  const fetch = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(resolve => { waiting.push(() => resolve(json())) }))
  vi.stubGlobal('fetch', fetch)
  return { fetch, release: () => waiting.splice(0).forEach(go => go()) }
}

const getUser = defineRequest<{ ok: boolean }>()({ method: 'GET', path: '/users/:id', fetchOptions: { cache: 'no-store' } })
const plainUser = defineRequest<{ ok: boolean }>()({ method: 'GET', path: '/plain/:id' })

describe('mergeFetchOptions', () => {
  it('call over endpoint over client, field by field', () => {
    expect(mergeFetchOptions({ credentials: 'include', mode: 'cors' }, { mode: 'same-origin', cache: 'no-store' }, { cache: 'reload' }))
      .toEqual({ credentials: 'include', mode: 'same-origin', cache: 'reload' })
  })
  it('a field set to undefined replaces nothing', () => {
    expect(mergeFetchOptions({ credentials: 'include' }, { credentials: undefined })).toEqual({ credentials: 'include' })
  })
  it('skips a level that is not an object, and always returns a fresh object', () => {
    const client = { credentials: 'include' as const }
    const merged = mergeFetchOptions(client, null, undefined, 'x')
    expect(merged).toEqual({ credentials: 'include' })
    expect(merged).not.toBe(client)
  })
})

describe('sendableFetchOptions', () => {
  it('drops the fields liaise controls', () => {
    expect(sendableFetchOptions({ credentials: 'include', method: 'DELETE', headers: { a: '1' }, body: 'x', signal: null, duplex: 'half' }))
      .toEqual({ credentials: 'include' })
  })
  it('anything but an object is no options', () => {
    for (const value of [null, undefined, 'include', 42]) expect(sendableFetchOptions(value)).toEqual({})
  })
})

describe('fetchOptions on createApi', () => {
  it('each level reaches fetch, and the most specific wins field by field', async () => {
    const { inits } = recorder()
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser }, fetchOptions: { credentials: 'include', cache: 'default', mode: 'cors' } })
    await api.getUser({ id: '1' }, { fetchOptions: { mode: 'same-origin' } })
    expect(inits[0]).toMatchObject({ credentials: 'include', cache: 'no-store', mode: 'same-origin', method: 'GET' })
  })

  it('a call field set to undefined keeps the level below', async () => {
    const { inits } = recorder()
    const api = createApi({ baseUrl: 'https://x.test', requests: { plainUser }, fetchOptions: { credentials: 'include' } })
    await api.plainUser({ id: '1' }, { fetchOptions: { credentials: undefined } })
    expect(inits[0].credentials).toBe('include')
  })

  it('middleware sees the merged options and can replace them', async () => {
    const { inits } = recorder()
    let seen: unknown
    const include: Middleware = async (ctx, next) => {
      seen = { ...ctx.request.fetchOptions }
      ctx.request.fetchOptions = { ...ctx.request.fetchOptions, credentials: 'include' }
      return next()
    }
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser }, middleware: [include] })
    await api.getUser({ id: '1' })
    expect(seen).toEqual({ cache: 'no-store' })
    expect(inits[0]).toMatchObject({ credentials: 'include', cache: 'no-store' })
  })

  it('a middleware can change a field in place', async () => {
    const { inits } = recorder()
    const keep: Middleware = async (ctx, next) => { ctx.request.fetchOptions!.keepalive = true; return next() }
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser }, middleware: [keep] })
    await api.getUser({ id: '1' })
    expect(inits[0].keepalive).toBe(true)
  })

  it("a middleware's change reaches neither the configuration nor the next call", async () => {
    const { inits } = recorder()
    const reload: Middleware = async (ctx, next) => { ctx.request.fetchOptions!.cache = 'reload'; return next() }
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser } })
    await api.getUser({ id: '1' }, { middleware: [reload] })
    await api.getUser({ id: '1' })
    expect(inits[0].cache).toBe('reload')
    expect(inits[1].cache).toBe('no-store')
    expect(getUser.config.fetchOptions).toEqual({ cache: 'no-store' })
  })

  it('a middleware that assigns something other than an object sends no options, and the call succeeds', async () => {
    const { inits } = recorder()
    const wipe: Middleware = async (ctx, next) => { ctx.request.fetchOptions = null as never; return next() }
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser }, fetchOptions: { credentials: 'include' }, middleware: [wipe] })
    const { error } = await api.getUser({ id: '1' })
    expect(error).toBeNull()
    expect(inits[0].credentials).toBeUndefined()
    expect(inits[0].cache).toBeUndefined()
  })

  it('a frozen object assigned by a middleware is read, never written', async () => {
    const { inits } = recorder()
    const frozen = Object.freeze({ credentials: 'include' as const })
    const assign: Middleware = async (ctx, next) => { ctx.request.fetchOptions = frozen; return next() }
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser }, middleware: [assign] })
    const { error } = await api.getUser({ id: '1' })
    expect(error).toBeNull()
    expect(inits[0].credentials).toBe('include')
    expect(frozen).toEqual({ credentials: 'include' })
  })

  it('method, headers, body and signal in the options never reach fetch, and a bodyless call has no body', async () => {
    const { inits } = recorder()
    const sneaky = { credentials: 'include', method: 'DELETE', headers: { 'x-evil': '1' }, body: 'payload', signal: AbortSignal.abort() } as unknown as FetchOptions
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser }, fetchOptions: sneaky })
    const { error } = await api.getUser({ id: '1' })
    expect(error).toBeNull()
    expect(inits[0].method).toBe('GET')
    expect(new Headers(inits[0].headers).has('x-evil')).toBe(false)
    expect('body' in inits[0]).toBe(false)
    expect(inits[0].signal?.aborted ?? false).toBe(false)
    expect(inits[0].credentials).toBe('include')
  })

  it('a POST body is still sent beside the options', async () => {
    const { inits } = recorder()
    const create = defineRequest<{ ok: boolean }, { name: string }>()({ method: 'POST', path: '/users' })
    const api = createApi({ baseUrl: 'https://x.test', requests: { create }, fetchOptions: { keepalive: true } })
    await api.create({ name: 'Ada' })
    expect(inits[0]).toMatchObject({ method: 'POST', keepalive: true, body: '{"name":"Ada"}' })
  })

  it('a retry sends the same options, a middleware change included, and so does result.retry()', async () => {
    let n = 0
    const { inits } = recorder(() => (n++ === 0 ? json({}, 503) : json()))
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const include: Middleware = async (ctx, next) => { ctx.request.fetchOptions = { ...ctx.request.fetchOptions, credentials: 'include' }; return next() }
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser }, middleware: [retryMiddleware(1), include] })
    const first = await api.getUser({ id: '1' })
    expect(first.error).toBeNull()
    await first.retry()
    expect(inits).toHaveLength(3)
    for (const init of inits) expect(init).toMatchObject({ credentials: 'include', cache: 'no-store' })
  })

  it('paginate passes them to every page', async () => {
    const { inits } = recorder(() => json({ next: inits.length < 2 ? 'b' : null }))
    const list = defineRequest<{ next: string | null }, { cursor?: string }>()({ method: 'GET', path: '/items' })
    const api = createApi({ baseUrl: 'https://x.test', requests: { list } })
    const pages = paginate(api.list, {}, { next: (page, prev) => (page.data.next ? { ...prev, cursor: page.data.next } : undefined), fetchOptions: { credentials: 'include' } })
    for await (const _page of pages) { /* walk every page */ }
    expect(inits).toHaveLength(2)
    expect(inits.every(init => init.credentials === 'include')).toBe(true)
  })
})

describe('fetchOptions and share', () => {
  const shared = defineRequest<{ ok: boolean }>()({ method: 'GET', path: '/me/:id', share: true })

  it('calls that differ only in credentials send two requests', async () => {
    const { fetch, release } = gated()
    const api = createApi({ baseUrl: 'https://x.test', requests: { shared } })
    const all = Promise.all([
      api.shared({ id: '1' }, { fetchOptions: { credentials: 'include' } }),
      api.shared({ id: '1' }, { fetchOptions: { credentials: 'omit' } }),
    ])
    await flush()
    expect(fetch).toHaveBeenCalledTimes(2)
    release()
    await all
  })

  it('the same options in a different key order share one request', async () => {
    const { fetch, release } = gated()
    const api = createApi({ baseUrl: 'https://x.test', requests: { shared } })
    const all = Promise.all([
      api.shared({ id: '1' }, { fetchOptions: { credentials: 'include', mode: 'cors' } }),
      api.shared({ id: '1' }, { fetchOptions: { mode: 'cors', credentials: 'include' } }),
    ])
    await flush()
    expect(fetch).toHaveBeenCalledTimes(1)
    release()
    await all
  })

  it('an options value that is not a primitive means no sharing', async () => {
    const { fetch, release } = gated()
    const withObject = { next: { revalidate: 60 } } as unknown as FetchOptions
    const api = createApi({ baseUrl: 'https://x.test', requests: { shared } })
    const all = Promise.all([api.shared({ id: '1' }, { fetchOptions: withObject }), api.shared({ id: '1' }, { fetchOptions: withObject })])
    await flush()
    expect(fetch).toHaveBeenCalledTimes(2)
    release()
    await all
  })

  it('a stray method or signal in the options (plain JS) changes nothing about sharing', async () => {
    const { fetch, release } = gated()
    const api = createApi({ baseUrl: 'https://x.test', requests: { shared } })
    const stray = { credentials: 'include', method: 'DELETE', signal: new AbortController().signal } as unknown as FetchOptions
    const all = Promise.all([
      api.shared({ id: '1' }, { fetchOptions: { credentials: 'include' } }),
      api.shared({ id: '1' }, { fetchOptions: stray }),
    ])
    await flush()
    expect(fetch).toHaveBeenCalledTimes(1)
    release()
    await all
  })
})

describe('fetchOptions and poll', () => {
  it('polls that differ only in fetchOptions run separate loops; identical ones share', async () => {
    vi.stubGlobal('window', globalThis) // polls are shared only where there is a window
    const { fetch } = recorder()
    const api = createApi({ baseUrl: 'https://x.test', requests: { plainUser } })
    const stops = [
      poll(api.plainUser, { id: '1' }, () => {}, { every: 60_000, fetchOptions: { credentials: 'include' } }),
      poll(api.plainUser, { id: '1' }, () => {}, { every: 60_000, fetchOptions: { credentials: 'omit' } }),
      poll(api.plainUser, { id: '1' }, () => {}, { every: 60_000, fetchOptions: { credentials: 'include' } }),
    ]
    await flush()
    expect(fetch).toHaveBeenCalledTimes(2)
    stops.forEach(stop => stop())
  })
})
