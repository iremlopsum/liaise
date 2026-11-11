// createGraphQL({ timeout: { queries, mutations } }): a default deadline per operation
// type. A side left out has no default; the per-call and per-operation levels still win.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createGraphQL, Operation, gql } from '../src/graphql.js'
import type { GraphQLTimeouts, Middleware } from '../src/types.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const QUERY = gql`query User { user { id } }`
const MUTATION = gql`mutation Save { save { id } }`
/** A fetch that settles only when its signal aborts. */
const hangs = () => {
  const fetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
  }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
const PENDING = Symbol('pending')
/** The call's error kind, or PENDING if it hasn't settled within `ms`. */
async function settles(p: Promise<{ error: { kind: string } | null }>, ms = 80): Promise<string | typeof PENDING> {
  const r = await Promise.race([p, new Promise<typeof PENDING>(r => setTimeout(() => r(PENDING), ms))])
  return r === PENDING ? PENDING : (r.error?.kind ?? 'ok')
}
const split = (timeout: number | GraphQLTimeouts, op: { queryTimeout?: number; share?: boolean } = {}) => createGraphQL({
  endpoint: 'https://x.test/graphql',
  timeout,
  queries: { user: new Operation<Record<string, never>, unknown>({ operation: QUERY, timeout: op.queryTimeout, share: op.share }) },
  mutations: { save: new Operation<Record<string, never>, unknown>({ operation: MUTATION }) },
})

describe('createGraphQL timeout per operation type', () => {
  it('{ queries } gives queries a deadline and mutations none', async () => {
    hangs()
    const gql = split({ queries: 20 })
    const stop = new AbortController()
    const [q, m] = await Promise.all([settles(gql.query.user()), settles(gql.mutation.save({}, { signal: stop.signal }))])
    stop.abort()
    expect(q).toBe('timeout')
    expect(m).toBe(PENDING)
  })

  it('{ mutations } gives mutations a deadline and queries none', async () => {
    hangs()
    const gql = split({ mutations: 20 })
    const stop = new AbortController()
    const [q, m] = await Promise.all([settles(gql.query.user({}, { signal: stop.signal })), settles(gql.mutation.save())])
    stop.abort()
    expect(q).toBe(PENDING)
    expect(m).toBe('timeout')
  })

  it("an operation's timeout: 0 opts out of its side's default", async () => {
    hangs()
    const gql = split({ queries: 20 }, { queryTimeout: 0 })
    const stop = new AbortController()
    const q = await settles(gql.query.user({}, { signal: stop.signal }))
    stop.abort()
    expect(q).toBe(PENDING)
  })

  it('a per-call timeout still applies where the side has no default', async () => {
    hangs()
    expect(await settles(split({ queries: 20 }).mutation.save({}, { timeout: 20 }))).toBe('timeout')
  })

  it('a number is still the default for every call', async () => {
    hangs()
    const gql = split(20)
    expect(await Promise.all([settles(gql.query.user()), settles(gql.mutation.save())])).toEqual(['timeout', 'timeout'])
  })

  it('under share, joined callers both time out on the side’s deadline', async () => {
    const fetch = hangs()
    const gql = split({ queries: 20 }, { share: true })
    expect(await Promise.all([settles(gql.query.user()), settles(gql.query.user())])).toEqual(['timeout', 'timeout'])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("under share, the side's default is the shared request's own deadline", async () => {
    // Each caller opts out of its own deadline, so only the shared request's can end it.
    const fetch = hangs()
    const gql = split({ queries: 20 }, { share: true })
    const r = await Promise.all([settles(gql.query.user({}, { timeout: 0 })), settles(gql.query.user({}, { timeout: 0 }))])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(r).toEqual(['timeout', 'timeout'])
  })

  it('a middleware that changes ctx.operationType does not change the deadline already chosen', async () => {
    hangs()
    const relabel: Middleware = (ctx, next) => { (ctx as { operationType?: string }).operationType = 'mutation'; return next() }
    const seen: Array<string | undefined> = []
    const after: Middleware = (ctx, next) => { seen.push(ctx.operationType); return next() }
    const gql = createGraphQL({
      endpoint: 'https://x.test/graphql',
      timeout: { queries: 20 },
      middleware: [relabel, after],
      queries: { user: new Operation<Record<string, never>, unknown>({ operation: QUERY }) },
    })
    expect(await settles(gql.query.user())).toBe('timeout')
    expect(seen).toEqual(['mutation']) // the change was made, and later middleware sees it
  })

  it("a flat client uses each document's type", async () => {
    hangs()
    const gql = createGraphQL({
      endpoint: 'https://x.test/graphql',
      timeout: { queries: 20 },
      operations: {
        user: new Operation<Record<string, never>, unknown>({ operation: QUERY }),
        save: new Operation<Record<string, never>, unknown>({ operation: MUTATION }),
      },
    })
    const stop = new AbortController()
    const [q, m] = await Promise.all([settles(gql.user()), settles(gql.save({}, { signal: stop.signal }))])
    stop.abort()
    expect(q).toBe('timeout')
    expect(m).toBe(PENDING)
  })

  it('a side that is not a number (plain JS) gets no deadline, and nothing throws', async () => {
    hangs()
    const gql = split({ queries: 'x' as unknown as number })
    const stop = new AbortController()
    const q = await settles(gql.query.user({}, { signal: stop.signal }))
    stop.abort()
    expect(q).toBe(PENDING)
  })
})
