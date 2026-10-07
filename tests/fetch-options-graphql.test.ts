import { describe, it, expect, vi, afterEach } from 'vitest'
import { createGraphQL, Operation } from '../src/index.js'
import type { FetchOptions, Middleware } from '../src/index.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const flush = () => new Promise<void>(r => setTimeout(r, 0))
const gqlOk = () => new Response(JSON.stringify({ data: { viewer: { id: '1' } } }), { status: 200, headers: { 'content-type': 'application/json' } })

function recorder() {
  const inits: RequestInit[] = []
  const fetch = vi.fn(async (_url: string, init: RequestInit) => { inits.push(init); return gqlOk() })
  vi.stubGlobal('fetch', fetch)
  return { fetch, inits }
}

function gated() {
  const waiting: Array<() => void> = []
  const fetch = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(resolve => { waiting.push(() => resolve(gqlOk())) }))
  vi.stubGlobal('fetch', fetch)
  return { fetch, release: () => waiting.splice(0).forEach(go => go()) }
}

type Viewer = { viewer: { id: string } }
const viewer = new Operation<Record<string, never>, Viewer>({ operation: 'query { viewer { id } }', fetchOptions: { cache: 'no-store' } })

describe('fetchOptions on createGraphQL', () => {
  it('each level reaches fetch, and the most specific wins field by field', async () => {
    const { inits } = recorder()
    const client = createGraphQL({ endpoint: 'https://x.test/graphql', operations: { viewer }, fetchOptions: { credentials: 'include', cache: 'default', mode: 'cors' } })
    await client.viewer({}, { fetchOptions: { mode: 'same-origin' } })
    expect(inits[0]).toMatchObject({ credentials: 'include', cache: 'no-store', mode: 'same-origin', method: 'POST' })
  })

  it('middleware sees the merged options and can change them', async () => {
    const { inits } = recorder()
    let seen: unknown
    const include: Middleware = async (ctx, next) => {
      seen = { ...ctx.request.fetchOptions }
      ctx.request.fetchOptions = { ...ctx.request.fetchOptions, credentials: 'include' }
      return next()
    }
    const client = createGraphQL({ endpoint: 'https://x.test/graphql', operations: { viewer }, middleware: [include] })
    await client.viewer()
    expect(seen).toEqual({ cache: 'no-store' })
    expect(inits[0]).toMatchObject({ credentials: 'include', cache: 'no-store' })
  })

  it('method, headers, body and signal in the options never reach fetch', async () => {
    const { inits } = recorder()
    const sneaky = { credentials: 'include', method: 'GET', headers: { 'x-evil': '1' }, body: 'payload', signal: AbortSignal.abort() } as unknown as FetchOptions
    const client = createGraphQL({ endpoint: 'https://x.test/graphql', operations: { viewer }, fetchOptions: sneaky })
    const { error } = await client.viewer()
    expect(error).toBeNull()
    expect(inits[0].method).toBe('POST')
    expect(new Headers(inits[0].headers).has('x-evil')).toBe(false)
    expect(inits[0].body).toBe(JSON.stringify({ query: 'query { viewer { id } }', variables: {} }))
    expect(inits[0].credentials).toBe('include')
  })
})

describe('fetchOptions and share (GraphQL)', () => {
  const shared = new Operation<Record<string, never>, Viewer>({ operation: 'query { viewer { id } }', share: true })

  it('operations that differ only in credentials send two requests', async () => {
    const { fetch, release } = gated()
    const client = createGraphQL({ endpoint: 'https://x.test/graphql', operations: { shared } })
    const all = Promise.all([
      client.shared({}, { fetchOptions: { credentials: 'include' } }),
      client.shared({}, { fetchOptions: { credentials: 'omit' } }),
    ])
    await flush()
    expect(fetch).toHaveBeenCalledTimes(2)
    release()
    await all
  })

  it('the same options in a different key order share one request', async () => {
    const { fetch, release } = gated()
    const client = createGraphQL({ endpoint: 'https://x.test/graphql', operations: { shared } })
    const all = Promise.all([
      client.shared({}, { fetchOptions: { credentials: 'include', mode: 'cors' } }),
      client.shared({}, { fetchOptions: { mode: 'cors', credentials: 'include' } }),
    ])
    await flush()
    expect(fetch).toHaveBeenCalledTimes(1)
    release()
    await all
  })
})
