import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApi } from '../src/create-api.js'
import { Request } from '../src/request.js'
import { createGraphQL, Operation, gql } from '../src/graphql.js'
import type { Middleware, RequestConfig } from '../src/types.js'
import { countingSignal } from './helpers/counting-signal.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const json = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })

// 25 sequential calls on one long-lived signal (a component-scoped
// controller), never aborted. Returns how many 'abort' listeners it still has.
async function runMany(call: (signal: AbortSignal) => Promise<unknown>) {
  const caller = countingSignal()
  for (let i = 0; i < 25; i++) await call(caller.signal)
  return caller.listeners()
}

describe('a long-lived caller signal ends with no listeners', () => {
  // [name, request config, per-call timeout]. With any timeout the operation
  // budget is a fresh merge and every later listener (the dedupe merge, the
  // share step's wait in core) listens to THAT, not to the caller's signal.
  // The `no timeout` rows are the search-box case: the caller's signal is the
  // budget itself, so the dedupe merge, or a shared call's wait on its round
  // trip, listens to it directly and must let go once the call settles.
  const cases: Array<[string, Partial<RequestConfig>, number | undefined]> = [
    ['plain', {}, 5000],
    ['dedupe', { dedupe: true }, 5000],
    ['dedupe, no timeout', { dedupe: true }, undefined],
    ['timeout', { timeout: 5000 }, 5000],
    ['dedupe + timeout', { dedupe: true, timeout: 5000 }, 5000],
    ['share', { share: true }, 5000],
    ['share, no timeout', { share: true }, undefined],
    ['share + timeout', { share: true, timeout: 5000 }, 5000],
  ]

  it.each(cases)('%s', async (_name, extra, timeout) => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true })))
    const get = new Request<Record<string, never>, unknown>({ method: 'GET', path: '/x', ...extra })
    const api = createApi({ baseUrl: 'https://x.test', requests: { get } })
    expect(await runMany(signal => api.get({}, { signal, timeout }))).toBe(0)
  })

  // Under share a caller waits on its own budget merged with any signal a
  // middleware installed. With no timeout the budget IS the caller's signal,
  // so that merge listens to it directly and must be released once the call
  // settles — one retained listener per call otherwise.
  it('share, with a middleware-installed signal and no timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true })))
    const installs: Middleware = (ctx, next) => { ctx.request.signal = new AbortController().signal; return next() }
    const get = new Request<Record<string, never>, unknown>({ method: 'GET', path: '/x', share: true })
    const api = createApi({ baseUrl: 'https://x.test', requests: { get }, middleware: [installs] })
    expect(await runMany(signal => api.get({}, { signal }))).toBe(0)
  })

  it('with a retrying middleware', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => (n++ % 2 === 0 ? new Response('', { status: 503 }) : json({}))))
    const twice: Middleware = async (_ctx, next) => { const r = await next(); return r.error ? next() : r }
    const get = new Request<Record<string, never>, unknown>({ method: 'GET', path: '/x', dedupe: true })
    const api = createApi({ baseUrl: 'https://x.test', requests: { get }, middleware: [twice] })
    expect(await runMany(signal => api.get({}, { signal, timeout: 5000 }))).toBe(0)
  })

  it.each([
    ['', 5000],
    [', no timeout', undefined],
  ])('on the GraphQL client%s', async (_name, timeout) => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { me: { id: '1' } } })))
    const me = new Operation<Record<string, never>, unknown>({ operation: gql`query { me { id } }`, dedupe: true, timeout })
    const client = createGraphQL({ endpoint: 'https://x.test/graphql', operations: { me } })
    expect(await runMany(signal => client.me({}, { signal }))).toBe(0)
  })
})

describe('releasing does not cut a live call loose', () => {
  // The README's pattern: a middleware forwards ctx.request.signal (the outer
  // call's own merged signal) into a nested call with no timeout of its own.
  // The nested call's budget is then that very signal, unchanged, and when
  // the nested call settles it must not release it: the outer call would no
  // longer hear its caller abort. One row per place a call releases. The
  // `with its own timeout` rows instead build a fresh merge ON that signal:
  // releasing it must not release the input along with it.
  const nestedVia: Array<[string, (signal: AbortSignal) => Promise<unknown>]> = [
    ['an unshared REST call', signal => api.refresh({}, { signal })],
    ['an unshared REST call with its own timeout', signal => api.refresh({}, { signal, timeout: 5000 })],
    ['a shared REST call', signal => api.refreshShared({}, { signal })],
    ['a shared REST call with its own timeout', signal => api.refreshShared({}, { signal, timeout: 5000 })],
    ['a GraphQL call', signal => gqlClient.me({}, { signal })],
  ]
  let api: any
  let gqlClient: any

  it.each(nestedVia)('a nested %s made with ctx.request.signal does not stop the outer caller aborting it', async (_name, nestedCall) => {
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      if (url.endsWith('/refresh')) return Promise.resolve(json({}))
      if (url.endsWith('/graphql')) return Promise.resolve(json({ data: { me: { id: '1' } } }))
      return new Promise<Response>((_res, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const refresh = new Request<Record<string, never>, unknown>({ method: 'POST', path: '/refresh' })
    const refreshShared = new Request<Record<string, never>, unknown>({ method: 'POST', path: '/refresh', share: true })
    const slow = new Request<Record<string, never>, unknown>({ method: 'GET', path: '/slow', timeout: 60_000 })
    const nested: Middleware = async (ctx, next) => {
      if (ctx.requestName === 'slow') await nestedCall(ctx.request.signal!)
      return next()
    }
    api = createApi({ baseUrl: 'https://x.test', requests: { refresh, refreshShared, slow }, middleware: [nested] })
    gqlClient = createGraphQL({
      endpoint: 'https://x.test/graphql',
      operations: { me: new Operation<Record<string, never>, unknown>({ operation: gql`query { me { id } }` }) },
    })

    const caller = new AbortController()
    const pending = api.slow({}, { signal: caller.signal })
    await new Promise(r => setTimeout(r, 10))
    caller.abort()
    // Bounded, so a regression fails as an assertion rather than a hang: with
    // the outer merge released, the abort never reaches the 60s request.
    const hung = new Promise(r => setTimeout(() => r({ error: { kind: 'still pending' } }), 500))
    const { error } = (await Promise.race([pending, hung])) as { error?: { kind: string } }
    expect(error?.kind).toBe('abort')
  })
})
