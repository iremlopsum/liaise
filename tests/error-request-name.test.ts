// error.request.name (both clients) and error.request.operationType (GraphQL): every
// ApiError a client builds for a call says which call it was, and never more than the
// key and the type. Variables stay in request.params only.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApi } from '../src/create-api.js'
import { Request } from '../src/request.js'
import { createGraphQL, Operation, gql } from '../src/graphql.js'
import { ApiError } from '../src/result.js'
import { pollUntil } from '../src/poll.js'
import type { Middleware, Result } from '../src/types.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
/** A fetch that settles only when its signal aborts. */
const hangs = () => vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
  init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
}))
const throws: Middleware = () => { throw new Error('mw') }
const never: Middleware = () => new Promise(() => {})

type Case = { kind: string; fetch: () => unknown; mw?: Middleware; timeout?: number; abort?: boolean }
const CASES: Case[] = [
  { kind: 'http', fetch: () => vi.fn(async () => json({ message: 'down' }, 500)) },
  { kind: 'network', fetch: () => vi.fn(async () => { throw new TypeError('Failed to fetch') }) },
  { kind: 'timeout', fetch: hangs, timeout: 20 },
  { kind: 'abort', fetch: hangs, abort: true },
  { kind: 'parse', fetch: () => vi.fn(async () => new Response('not json', { status: 200, headers: { 'Content-Type': 'application/json' } })) },
  { kind: 'middleware', fetch: () => vi.fn(async () => json({})), mw: throws },
  { kind: 'timeout', fetch: () => vi.fn(async () => json({})), mw: never, timeout: 20 }, // the backstop
]
const options = (c: Case) => {
  const controller = new AbortController()
  if (c.abort) setTimeout(() => controller.abort(), 5)
  return { ...(c.timeout ? { timeout: c.timeout } : {}), ...(c.abort ? { signal: controller.signal } : {}), ...(c.mw ? { middleware: [c.mw] } : {}) }
}

describe('REST: error.request.name', () => {
  const getUser = new Request<{ id: string }, unknown>({ method: 'GET', path: '/users/:id' })

  it.each(CASES)('$kind → name is the endpoint key, and no operationType', async (c) => {
    vi.stubGlobal('fetch', c.fetch())
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser } })
    const { error } = await api.getUser({ id: '1' }, options(c))
    expect(error?.kind).toBe(c.kind)
    expect(error?.request.name).toBe('getUser')
    expect('operationType' in error!.request).toBe(false)
  })

  it('a call refused before sending (an unresolved :id) carries the name', async () => {
    const fetch = vi.fn(async () => json({}))
    vi.stubGlobal('fetch', fetch)
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser } })
    const { error } = await api.getUser({} as { id: string })
    expect(fetch).not.toHaveBeenCalled()
    expect(error?.request.name).toBe('getUser')
  })

  it('onError receives the named error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 503)))
    const seen: Array<string | undefined> = []
    const api = createApi({ baseUrl: 'https://x.test', requests: { getUser }, onError: e => { seen.push(e.request.name) } })
    await api.getUser({ id: '1' })
    expect(seen).toEqual(['getUser'])
  })
})

describe('GraphQL: error.request.name and operationType', () => {
  const QUERY = gql`query User($id: ID!) { user(id: $id) { id } }`
  const MUTATION = gql`mutation User($id: ID!) { touchUser(id: $id) { id } }`
  const client = (extra: { share?: boolean; onError?: (e: ApiError) => void } = {}) => createGraphQL({
    endpoint: 'https://x.test/graphql',
    onError: extra.onError,
    queries: { user: new Operation<{ id: string }, unknown>({ operation: QUERY, share: extra.share }) },
    mutations: { user: new Operation<{ id: string }, unknown>({ operation: MUTATION, share: extra.share }) },
  })
  const SIDES = [['query', (c: ReturnType<typeof client>) => c.query.user], ['mutation', (c: ReturnType<typeof client>) => c.mutation.user]] as const

  for (const [type, pick] of SIDES) {
    it.each(CASES)(`${type}: $kind → the key and '${type}'`, async (c) => {
      vi.stubGlobal('fetch', c.fetch())
      const { error } = await pick(client())({ id: '1' }, options(c))
      expect(error?.kind).toBe(c.kind)
      expect(error?.request.name).toBe('user')
      expect(error?.request.operationType).toBe(type)
    })

    it(`${type}: a GraphQL errors response with partialData`, async () => {
      vi.stubGlobal('fetch', vi.fn(async () => json({ errors: [{ message: 'no' }], data: { user: null } })))
      const { error } = await pick(client())({ id: '1' })
      expect(error?.partialData).toEqual({ user: null })
      expect(error?.request.name).toBe('user')
      expect(error?.request.operationType).toBe(type)
    })

    it(`${type}: callers joined under share both get the name and type`, async () => {
      const fetch = vi.fn(async () => { await new Promise(r => setTimeout(r, 5)); return json({}, 502) })
      vi.stubGlobal('fetch', fetch)
      const c = client({ share: true })
      const [a, b] = await Promise.all([pick(c)({ id: '1' }), pick(c)({ id: '1' })])
      expect(fetch).toHaveBeenCalledTimes(1)
      for (const r of [a, b]) {
        expect(r.error?.request.name).toBe('user')
        expect(r.error?.request.operationType).toBe(type)
      }
    })
  }

  it('onError receives the named error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 503)))
    const seen: unknown[] = []
    await client({ onError: e => { seen.push([e.request.name, e.request.operationType]) } }).mutation.user({ id: '1' })
    expect(seen).toEqual([['user', 'mutation']])
  })

  it('pollUntil giving up carries the endpoint it polled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { user: { id: '1' } } })))
    const result: Result<unknown> = await pollUntil(client().query.user, { id: '1' }, { every: 5, until: () => false, giveUpAfter: 40 })
    expect(result.error?.kind).toBe('timeout')
    expect(result.error?.request.name).toBe('user')
    expect(result.error?.request.operationType).toBe('query')
  })

  it('the new fields never carry the variables', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 500)))
    const { error } = await client().mutation.user({ id: 'secret-token' })
    expect(JSON.stringify({ name: error?.request.name, type: error?.request.operationType })).not.toContain('secret')
  })
})

describe('new ApiError()', () => {
  it("gives request.name '' when the options leave it out", () => {
    const e = new ApiError({ kind: 'http', status: 500, statusText: '', body: null, headers: new Headers(), request: { method: 'GET', url: '/', params: {} } })
    expect(e.request.name).toBe('')
    expect('operationType' in e.request).toBe(false)
  })
})
