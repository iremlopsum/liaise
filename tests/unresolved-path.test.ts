import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApi } from '../src/create-api.js'
import { Request } from '../src/request.js'

describe('unresolved path param surfaces as a Result', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.restoreAllMocks())

  it('returns a network-error Result instead of throwing', async () => {
    const api = createApi({
      baseUrl: '/api',
      requests: { getUser: new Request<{ id: string }, unknown>({ method: 'GET', path: '/users/:userId' }) },
    })
    const r = await api.getUser({ id: '42' })
    expect(r.error).not.toBeNull()
    expect(r.error!.status).toBe(0)
    expect(String(r.error!.body)).toContain(':userId')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('reports a properly joined URL in the error metadata', async () => {
    // The synchronous catch builds its own URL because buildUrl never
    // returned one. It used to concatenate naively, reproducing the double
    // slash in the very error that describes the failure.
    const api = createApi({
      baseUrl: 'https://x.com/',
      requests: { health: new Request<Record<string, never>, unknown>({ method: 'GET', path: '/health' }) },
    })
    const r = await api.health({ nested: { a: 1 } } as never)
    expect(r.error).not.toBeNull()
    expect(r.error!.request.url).toBe('https://x.com/health')
  })
})

describe('a :name that cannot be a path token surfaces as a Result', () => {
  // 5.2.1. The fetch stub returns a real Response on purpose: with a bare
  // vi.fn() the call would crash reading `.ok` and come back as a 'network'
  // error even with the refusal removed -- passing for the wrong reason.
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 }))))
  afterEach(() => vi.restoreAllMocks())

  it('refuses a mid-segment :name a param names, without sending', async () => {
    const api = createApi({
      baseUrl: 'https://api.test',
      requests: { getItem: new Request<{ version: string }, unknown>({ method: 'GET', path: '/items/v:version' }) },
    })
    const r = await api.getItem({ version: '2' })
    expect(r.error?.kind).toBe('network')
    expect(r.error?.status).toBe(0)
    expect(r.error?.body).toBeInstanceOf(TypeError)
    expect(String(r.error?.body)).toMatch(/":version" in path "\/items\/v:version".*must start a path segment/)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('refuses a :name in the query string, without sending', async () => {
    const api = createApi({
      baseUrl: 'https://api.test',
      requests: { price: new Request<{ id: string; qs: string }, unknown>({ method: 'GET', path: '/coins/:id/price?:qs' }) },
    })
    const r = await api.price({ id: 'btc', qs: 'vs=usd' })
    expect(r.error?.kind).toBe('network')
    expect(r.error?.status).toBe(0)
    expect(r.error?.body).toBeInstanceOf(TypeError)
    expect(String(r.error?.body)).toMatch(/can't fill a query string: ":qs"/)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('still sends a mid-segment colon no param names', async () => {
    const api = createApi({
      baseUrl: 'https://api.test',
      requests: { batchGet: new Request<{ documents: string[] }, unknown>({ method: 'POST', path: '/v1/documents:batchGet' }) },
    })
    const r = await api.batchGet({ documents: ['a'] })
    expect(r.error).toBeNull()
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe('https://api.test/v1/documents:batchGet')
  })
})
