import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApi } from '../src/create-api.js'
import { Request } from '../src/request.js'
import { createGraphQL, Operation } from '../src/graphql.js'

const api = () => createApi({
  baseUrl: '',
  requests: { g: new Request<Record<string, never>, unknown>({ method: 'GET', path: '/g' }) },
})

describe('malformed body on a successful response', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () =>
    new Response('<html>oops</html>', { status: 200, statusText: 'OK' }))))
  afterEach(() => vi.restoreAllMocks())

  it('reports kind "parse", not a network error', async () => {
    expect((await api().g()).error?.kind).toBe('parse')
  })

  it('keeps the real HTTP status', async () => {
    expect((await api().g()).error?.status).toBe(200)
  })

  it('keeps the Response so headers stay reachable', async () => {
    const r = await api().g()
    expect(r.response).not.toBeNull()
    expect(r.response!.status).toBe(200)
  })

  // Boundary check, not a fix discriminator: the SyntaxError lands in `body`
  // regardless of which catch block captures it, so this passes identically
  // before and after the fix. It documents that `body` still carries the
  // native parse error once routing is corrected.
  it('puts the SyntaxError in body', async () => {
    expect(String((await api().g()).error?.body)).toContain('JSON')
  })
})

// Boundary check, not a fix discriminator: this exercises the fetch-throw
// (network) path, which the parse-routing fix never touches. It passes
// identically before and after, and exists to pin that a genuine network
// failure is not accidentally reclassified as 'parse'.
describe('a genuine network failure is still kind "network"', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') })))
  afterEach(() => vi.restoreAllMocks())

  it('keeps status 0 and a null response', async () => {
    const r = await api().g()
    expect(r.error?.kind).toBe('network')
    expect(r.error?.status).toBe(0)
    expect(r.response).toBeNull()
  })
})

// Non-regression check, not a fix discriminator: `!response.ok` is evaluated
// before the new parse try/catch, so no 4xx/5xx can ever reach it -- a 5xx
// with an unparseable body already took the http path (kind 'http') before
// this task, and still does. This test passes identically before and after
// the fix; it exists to catch a *future* refactor (e.g. merging the http and
// success parse try/catches) that inverts or collapses that branch order.
describe('a 5xx with an unparseable body is unaffected by this task', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () =>
    new Response('not json', { status: 503, statusText: 'Service Unavailable' }))))
  afterEach(() => vi.restoreAllMocks())

  // Round 5 review, Finding M3: no test committed so far actually asserts
  // kind: 'http' + body: null for a genuinely unparseable non-2xx body --
  // the integration suite's "slow-but-uncancelled" control test exercises a
  // *parseable* (if slowly-delivered) 503 body, and the retry test below
  // only counts fetch calls. This is the direct pin the retry test's own
  // comment claims already existed.
  it('classifies as http with a null body, not swallowed as an abort or a parse failure', async () => {
    const r = await api().g()
    expect(r.error?.kind).toBe('http')
    expect(r.error?.status).toBe(503)
    expect(r.error?.body).toBeNull()
    expect(r.response).not.toBeNull()
  })

  it('retryMiddleware already saw the real status and retried -- ordering unchanged', async () => {
    const { retryMiddleware } = await import('../src/built-in-middleware.js')
    const a = createApi({
      baseUrl: '', middleware: [retryMiddleware({ max: 2, baseDelay: 1 })],
      requests: { g: new Request<Record<string, never>, unknown>({ method: 'GET', path: '/g' }) },
    })
    await a.g()
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3)
  })
})

// The one classification the exchange refactor changed on purpose. Both
// clients used to check "is the signal aborted NOW" when a body failed to
// decode, so a body that was read in full and THEN failed to parse was
// reported as an abort if the signal happened to abort in between. Provenance
// is now decided at the read (src/utils/exchange.ts): only a read that failed
// while the signal handed to fetch was aborted is an abort. These pin that —
// restoring the old `signal?.aborted` guard in either decode catch turns them
// red.
//
// The stream enqueues the whole (malformed) body, closes, and aborts the
// caller's signal in the same pull, so the read completes and the abort lands
// before decoding runs. `highWaterMark: 0` keeps the stream from pulling until
// the body is actually read. The backstop allows the chain a macrotask after
// an abort, and the chain settles within microtasks, so the Result is core's.
describe('a body read in full, then the signal aborts, then decoding fails', () => {
  afterEach(() => vi.restoreAllMocks())

  const malformedThenAbort = (ac: AbortController, status: number) =>
    vi.fn(async () => new Response(
      new ReadableStream({
        pull(c) {
          c.enqueue(new TextEncoder().encode('{bad'))
          c.close()
          ac.abort()
        },
      }, { highWaterMark: 0 }),
      { status }
    ))

  it("REST 2xx: reports kind 'parse' with the real status and Response, not an abort", async () => {
    const ac = new AbortController()
    vi.stubGlobal('fetch', malformedThenAbort(ac, 200))
    const r = await api().g(undefined, { signal: ac.signal })
    expect(ac.signal.aborted).toBe(true)
    expect(r.error?.kind).toBe('parse')
    expect(r.error?.status).toBe(200)
    expect(r.response).not.toBeNull()
  })

  it("REST non-2xx: reports kind 'http' with a null body, not an abort", async () => {
    const ac = new AbortController()
    vi.stubGlobal('fetch', malformedThenAbort(ac, 500))
    const r = await api().g(undefined, { signal: ac.signal })
    expect(ac.signal.aborted).toBe(true)
    expect(r.error?.kind).toBe('http')
    expect(r.error?.status).toBe(500)
    expect(r.error?.body).toBeNull()
  })

  // graphql.ts's non-2xx catch carried the same guard; its 2xx parse try
  // never did, so there is no GraphQL 2xx counterpart to pin.
  it("GraphQL non-2xx: reports kind 'http' with a null body, not an abort", async () => {
    const ac = new AbortController()
    vi.stubGlobal('fetch', malformedThenAbort(ac, 500))
    const client = createGraphQL({
      endpoint: '/gql',
      operations: { q: new Operation<Record<string, never>, unknown>({ operation: 'query { q }' }) },
    })
    const r = await client.q(undefined, { signal: ac.signal })
    expect(ac.signal.aborted).toBe(true)
    expect(r.error?.kind).toBe('http')
    expect(r.error?.status).toBe(500)
    expect(r.error?.body).toBeNull()
  })
})
