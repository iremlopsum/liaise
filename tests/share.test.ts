import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApi } from '../src/create-api.js'
import { Request } from '../src/request.js'
import { ApiError } from '../src/result.js'
import { cacheMiddleware } from '../src/built-in-middleware.js'
import { ABANDONED, wasJoined } from '../src/utils/share.js'
import type { Middleware } from '../src/types.js'

// ---------------------------------------------------------------------------
// Since 5.1.0 sharing is decided inside core, after every middleware, on what
// is about to be sent: endpoint name, method, final URL, final headers (minus
// the tracing list) and body. Every caller runs its own pipeline — setup,
// middleware, deadlines, its own Result — and only the network round trip is
// shared. Sharing therefore happens a few microtasks later than it did when it
// wrapped the whole call, so rows that count fetch calls wait with `flush()`.
// ---------------------------------------------------------------------------

/**
 * Flushes the entire microtask queue: a macrotask (`setTimeout`) only runs
 * once every pending microtask has drained, so this guarantees any onError
 * report still in flight through a promise chain has fired before we assert
 * on it — regardless of how many `.then` hops separate it from the last
 * `await` in the test.
 */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

function controllable() {
  const calls: {
    resolve: () => void
    respond: (status: number, body?: string) => void
    reject: (err: unknown) => void
    aborted: () => boolean
    reason: () => unknown
  }[] = []
  const fn = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((res, rej) => {
    const s = init.signal as AbortSignal | undefined
    s?.addEventListener('abort', () => rej(s.reason))
    calls.push({
      resolve: () => res(new Response('{"ok":1}', { status: 200 })),
      respond: (status, body = '{}') => res(new Response(body, { status })),
      reject: rej,
      aborted: () => !!s?.aborted,
      reason: () => s?.reason,
    })
  }))
  return { fn, calls }
}

const shared = () => createApi({
  baseUrl: '',
  requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) },
})

const sentHeader = (fn: ReturnType<typeof controllable>['fn'], call: number, name: string) =>
  new Headers(fn.mock.calls[call][1].headers).get(name)

/** The call's Result, or 'hung' if it has not settled within `ms` — a hang fails as an assertion. */
async function within<T>(p: Promise<T>, ms = 500): Promise<T | 'hung'> {
  let timer!: ReturnType<typeof setTimeout>
  const hung = new Promise<'hung'>(r => { timer = setTimeout(() => r('hung'), ms) })
  try { return await Promise.race([p, hung]) } finally { clearTimeout(timer) }
}

describe('share', () => {
  afterEach(() => vi.restoreAllMocks())

  it('coalesces identical simultaneous calls into one fetch', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const all = Promise.all([api.get({ id: '1' }), api.get({ id: '1' }), api.get({ id: '1' })])
    await flush()
    expect(f.fn.mock.calls.length).toBe(1)
    f.calls[0].resolve()
    const results = await all
    expect(results.every(r => r.error === null)).toBe(true)
    // One request, but every caller ran its own pipeline: its own Result, and
    // its own data decoded from the one shared read.
    expect(results[0]).not.toBe(results[1])
    expect(results[0].data).not.toBe(results[1].data)
    expect(results[0].data).toEqual(results[1].data)
  })

  it('does not coalesce different params', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const all = Promise.all([api.get({ id: '1' }), api.get({ id: '2' })])
    await flush()
    expect(f.fn.mock.calls.length).toBe(2)
    f.calls[0].resolve(); f.calls[1].resolve()
    await all
  })

  // Per-call headers are part of what is sent, so they are part of the key:
  // identical ones share, different ones never do.
  it('shares calls whose per-call headers are identical', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const all = Promise.all([
      api.get({ id: '1' }, { headers: { 'X-Tenant': 'a' } }),
      api.get({ id: '1' }, { headers: { 'X-Tenant': 'a' } }),
    ])
    await flush()
    expect(f.fn.mock.calls.length).toBe(1)
    f.calls[0].resolve()
    const results = await all
    expect(results.every(r => r.error === null)).toBe(true)
  })

  it('does not share calls whose per-call headers differ, and sends each with its own', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const all = Promise.all([
      api.get({ id: '1' }, { headers: { 'X-Tenant': 'a' } }),
      api.get({ id: '1' }, { headers: { 'X-Tenant': 'b' } }),
    ])
    await flush()
    expect(f.fn.mock.calls.length).toBe(2)
    expect([sentHeader(f.fn, 0, 'x-tenant'), sentHeader(f.fn, 1, 'x-tenant')]).toEqual(['a', 'b'])
    f.calls[0].resolve(); f.calls[1].resolve()
    await all
  })

  // ---------------------------------------------------------------------------
  // A call whose per-call headers keep it from sharing is the only caller of
  // its own round trip. It must still honour THIS caller's own signal and
  // per-call timeout, and ending it must not touch the other request.
  //
  // A prior variant (before 5.1.0) keyed the operation deadline's "is this
  // shared" flag on `request.config.share` rather than on whether this call
  // actually shared, and a declining call became uncancellable: it would hang
  // on the never-resolving mock below. Bounded so a regression of that shape
  // fails the test instead of the whole suite.
  // ---------------------------------------------------------------------------
  it('still honours options.signal on a call whose per-call headers keep it from sharing', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const ac = new AbortController()
    const p = api.get({ id: '1' }, { headers: { 'X-Tenant': 'a' }, signal: ac.signal })
    const other = api.get({ id: '1' }, { headers: { 'X-Tenant': 'b' } })
    await flush()
    expect(f.fn.mock.calls.length).toBe(2)
    ac.abort()
    expect((await p).error?.kind).toBe('abort')
    expect(f.calls[0].aborted()).toBe(true)    // its only caller gave up
    expect(f.calls[1].aborted()).toBe(false)   // the other request is untouched
    f.calls[1].resolve()
    expect((await other).error).toBeNull()
  }, 2000)

  it('still honours options.timeout on a call whose per-call headers keep it from sharing', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const p = api.get({ id: '1' }, { headers: { 'X-Tenant': 'a' }, timeout: 20 })
    const other = api.get({ id: '1' }, { headers: { 'X-Tenant': 'b' } })
    expect((await p).error?.kind).toBe('timeout')
    expect(f.fn.mock.calls.length).toBe(2)
    expect(f.calls[1].aborted()).toBe(false)
    f.calls[1].resolve()
    expect((await other).error).toBeNull()
  }, 2000)

  it('lets one sharer abort without harming the others', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const ac = new AbortController()
    const a = api.get({ id: '1' }, { signal: ac.signal })
    const b = api.get({ id: '1' })
    await flush()
    ac.abort()
    expect((await a).error?.kind).toBe('abort')
    expect(f.calls[0].aborted()).toBe(false)
    f.calls[0].resolve()
    expect((await b).error).toBeNull()
  })

  it('aborts the underlying request when the last sharer aborts', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const a1 = new AbortController(), a2 = new AbortController()
    const a = api.get({ id: '1' }, { signal: a1.signal })
    const b = api.get({ id: '1' }, { signal: a2.signal })
    await flush()
    a1.abort()
    await a
    expect(f.calls[0].aborted()).toBe(false)
    a2.abort()
    await b
    expect(f.calls[0].aborted()).toBe(true)
  })

  it('throws at createApi when share and dedupe are both set', () => {
    expect(() => createApi({
      baseUrl: '',
      requests: { bad: new Request<Record<string, never>, unknown>({ method: 'GET', path: '/b', share: true, dedupe: true }) },
    })).toThrow(/bad/)
  })

  it('bounds only its own caller with a per-call timeout', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const impatient = api.get({ id: '1' }, { timeout: 20 })
    const patient = api.get({ id: '1' })
    await flush()
    expect(f.fn.mock.calls.length).toBe(1)              // a timeout does not prevent sharing

    const r = await impatient
    expect(r.error?.kind).toBe('timeout')
    expect(f.calls[0].aborted()).toBe(false)            // the shared request continues

    f.calls[0].resolve()
    expect((await patient).error).toBeNull()
  })

  it('starts a new request once the shared one has settled', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const first = api.get({ id: '1' }); await flush()
    f.calls[0].resolve(); await first
    const second = api.get({ id: '1' }); await flush()
    expect(f.fn.mock.calls.length).toBe(2)
    f.calls[1].resolve(); await second
  })

  // Per-call middleware runs for its own caller and is judged by what it
  // leaves behind: one that changes nothing still shares, one that changes
  // what is sent does not.
  it('shares a call whose per-call middleware changes nothing', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const passthrough: Middleware = async (_ctx, next) => next()
    const all = Promise.all([
      api.get({ id: '1' }),
      api.get({ id: '1' }, { middleware: [passthrough] }),
    ])
    await flush()
    expect(f.fn.mock.calls.length).toBe(1)
    f.calls[0].resolve()
    await all
  })

  it('does not share a call whose per-call middleware sets a header', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const flag: Middleware = async (ctx, next) => { ctx.request.headers.set('x-flag', '1'); return next() }
    const all = Promise.all([
      api.get({ id: '1' }),
      api.get({ id: '1' }, { middleware: [flag] }),
    ])
    await flush()
    expect(f.fn.mock.calls.length).toBe(2)
    expect([sentHeader(f.fn, 0, 'x-flag'), sentHeader(f.fn, 1, 'x-flag')]).toEqual([null, '1'])
    f.calls[0].resolve(); f.calls[1].resolve()
    await all
  })

  // ---------------------------------------------------------------------------
  // An upload body (FormData, Blob, ArrayBuffer, a typed array, DataView or a
  // stream) cannot be compared cheaply and safely, so a call that sends one
  // never shares — not even with an identical payload. Before 2.2.1 a
  // params-based key collapsed every FormData to "{}", and two different
  // payloads coalesced: one caller got the response to the other's upload and
  // its own payload was never sent at all.
  // ---------------------------------------------------------------------------
  it('does not share FormData bodies, even identical ones', async () => {
    const calls: { resolve: (data: unknown) => void }[] = []
    const fn = vi.fn((_u: string, _init: RequestInit) => new Promise<Response>(res => {
      calls.push({ resolve: (data: unknown) => res(new Response(JSON.stringify(data), { status: 200 })) })
    }))
    vi.stubGlobal('fetch', fn)

    const api = createApi({
      baseUrl: '',
      requests: { upload: new Request<FormData, { who: string }>({ method: 'POST', path: '/upload', share: true }) },
    })

    const fdA = new FormData(); fdA.append('payload', 'SAME')
    const fdB = new FormData(); fdB.append('payload', 'SAME')

    const pA = api.upload(fdA)
    const pB = api.upload(fdB)
    await flush()

    expect(fn.mock.calls.length).toBe(2)
    expect(fn.mock.calls.map(c => c[1].body)).toEqual([fdA, fdB]) // each sent its own payload

    calls[0].resolve({ who: 'A' })
    calls[1].resolve({ who: 'B' })

    const [rA, rB] = await Promise.all([pA, pB])
    expect(rA.data).toEqual({ who: 'A' })
    expect(rB.data).toEqual({ who: 'B' })
  })

  // ---------------------------------------------------------------------------
  // 4.4.3 made the (then params-based) key see nested values; a nested Date
  // used to key as "{}" and two different values coalesced. Since 5.1.0 the
  // key is the serialised body itself, so these hold by construction — kept
  // as the regression pins they were.
  // ---------------------------------------------------------------------------
  it('does not coalesce different nested-Date params', async () => {
    const calls: { resolve: (data: unknown) => void }[] = []
    const fn = vi.fn((_u: string, _init: RequestInit) => new Promise<Response>(res => {
      calls.push({ resolve: (data: unknown) => res(new Response(JSON.stringify(data), { status: 200 })) })
    }))
    vi.stubGlobal('fetch', fn)

    const api = createApi({
      baseUrl: '',
      requests: { search: new Request<{ since: Date }, { who: string }>({ method: 'POST', path: '/search', share: true }) },
    })

    const pA = api.search({ since: new Date('2026-01-01T00:00:00.000Z') })
    const pB = api.search({ since: new Date('2026-02-01T00:00:00.000Z') })
    await flush()

    expect(fn.mock.calls.length).toBe(2)

    calls[0].resolve({ who: 'A' })
    calls[1].resolve({ who: 'B' })

    const [rA, rB] = await Promise.all([pA, pB])
    expect(rA.data).toEqual({ who: 'A' })
    expect(rB.data).toEqual({ who: 'B' })
  })

  it('coalesces identical nested-Date params', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = createApi({
      baseUrl: '',
      requests: { search: new Request<{ since: Date }, { ok: number }>({ method: 'POST', path: '/search', share: true }) },
    })
    const all = Promise.all([
      api.search({ since: new Date('2026-01-01T00:00:00.000Z') }),
      api.search({ since: new Date('2026-01-01T00:00:00.000Z') }),
    ])
    await flush()
    expect(f.fn.mock.calls.length).toBe(1)
    f.calls[0].resolve()
    const results = await all
    expect(results.every(r => r.error === null)).toBe(true)
  })

  it('shares params with hidden state when what is sent is identical', async () => {
    // Private-field state never reaches the wire: both bodies serialise to
    // '{"price":{}}'. The server receives the same bytes and cannot tell the
    // two calls apart, so sharing them is safe. (Before 5.1.0 the params-based
    // key could not see the state either, and declined.)
    class Money {
      #cents: number
      constructor(cents: number) { this.#cents = cents }
      get amount() { return this.#cents / 100 }
    }
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = createApi({
      baseUrl: '',
      requests: { quote: new Request<{ price: Money }, { ok: number }>({ method: 'POST', path: '/quote', share: true }) },
    })
    const all = Promise.all([api.quote({ price: new Money(100) }), api.quote({ price: new Money(100) })])
    await flush()
    expect(f.fn.mock.calls.length).toBe(1)
    expect(f.fn.mock.calls[0][1].body).toBe('{"price":{}}')
    f.calls[0].resolve()
    await all
  })

  it('shares identical BigInt query params, since they send the same URL', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = createApi({
      baseUrl: 'https://api.example.com',
      requests: { get: new Request<{ id: bigint }, { ok: number }>({ method: 'GET', path: '/get', share: true }) },
    })
    const all = Promise.all([api.get({ id: 10n }), api.get({ id: 10n })])
    await flush()
    expect(f.fn.mock.calls.map(c => c[0])).toEqual(['https://api.example.com/get?id=10'])
    f.calls[0].resolve()
    await all
  })

  it('does not coalesce different BigInt query params', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = createApi({
      baseUrl: 'https://api.example.com',
      requests: { get: new Request<{ id: bigint }, { ok: number }>({ method: 'GET', path: '/get', share: true }) },
    })
    const all = Promise.all([api.get({ id: 10n }), api.get({ id: 20n })])
    await flush()
    expect(f.fn.mock.calls.length).toBe(2)
    expect(f.fn.mock.calls.map(c => c[0])).toEqual(['https://api.example.com/get?id=10', 'https://api.example.com/get?id=20'])
    f.calls[0].resolve(); f.calls[1].resolve()
    await all
  })

  it('coalesces identical top-level Map params', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = createApi({
      baseUrl: '',
      requests: { upload: new Request<Map<string, string>, { ok: number }>({ method: 'POST', path: '/upload', share: true }) },
    })
    const all = Promise.all([
      api.upload(new Map([['payload', 'same']])),
      api.upload(new Map([['payload', 'same']])),
    ])
    await flush()
    expect(f.fn.mock.calls.length).toBe(1)
    f.calls[0].resolve()
    await all
  })

  // ---------------------------------------------------------------------------
  // Finding 2 (post-review): a round trip whose last caller has already given
  // up is dying, but its entry would only leave the table once the request
  // actually settles, at least one microtask after the abort. A caller that
  // shows up in the same tick as that last give-up, with no await in between,
  // must get a genuine new request rather than joining one that is being
  // cancelled. ShareTracker.run drops the entry as the last caller leaves and
  // never joins an entry with no callers, a settled one, or an aborted one.
  // ---------------------------------------------------------------------------
  it('does not join a dying entry when a new call arrives before cleanup runs', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const ac = new AbortController()

    const first = api.get({ id: '1' }, { signal: ac.signal })
    await flush()
    expect(f.fn.mock.calls.length).toBe(1)

    ac.abort()                          // the only caller leaves -> the round trip is abandoned
    const second = api.get({ id: '1' }) // no await between the abort and this call

    expect(f.fn.mock.calls.length).toBe(2) // must be a genuine new request, not a join

    const r1 = await first
    expect(r1.error?.kind).toBe('abort')

    f.calls[1].resolve()
    const r2 = await second
    expect(r2.error).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // A shared round trip that fails without a response (offline, DNS, CORS)
  // reaches every caller as a real Result of its own — and, because each of
  // those errors is derived from the one shared round trip, onError hears
  // about it once, not once per caller.
  // ---------------------------------------------------------------------------
  it('hands every caller a real Result when the shared fetch rejects, and reports it once', async () => {
    const kinds: string[] = []
    const fetchMock = vi.fn(() => new Promise<Response>((_res, rej) => {
      setTimeout(() => rej(new TypeError('Failed to fetch')), 10)
    }))
    vi.stubGlobal('fetch', fetchMock)
    const api = createApi({
      baseUrl: '',
      onError: e => { kinds.push(e.kind) },
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) },
    })

    const ac = new AbortController()
    const [plain, watched] = await Promise.all([
      api.get({ id: '1' }),
      api.get({ id: '1' }, { signal: ac.signal }),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    for (const r of [plain, watched]) {
      expect(r.data).toBeNull()
      expect(r.error).toBeInstanceOf(ApiError)
      expect(r.error!.kind).toBe('network')
      expect(r.error!.body).toBeInstanceOf(TypeError)
    }
    expect(plain.error).not.toBe(watched.error)
    await flush()
    expect(kinds).toEqual(['network'])
  })

  // ---------------------------------------------------------------------------
  // I3: a sharer's own timeout is a genuine failure and must reach the error
  // tracker exactly as the identical non-shared call does. (A sharer used to
  // build its Result outside the post-execution hook and reported nothing.)
  // ---------------------------------------------------------------------------
  it("reports a sharer's own timeout to onError, as the non-shared call does", async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const kinds: (string | undefined)[] = []
    const api = createApi({
      baseUrl: '',
      onError: e => { kinds.push(e.kind) },
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) },
    })

    const impatient = api.get({ id: '1' }, { timeout: 20 })
    const patient = api.get({ id: '1' })
    await flush()

    expect((await impatient).error?.kind).toBe('timeout')
    expect(kinds).toEqual(['timeout'])

    f.calls[0].resolve()
    expect((await patient).error).toBeNull()
    expect(kinds).toEqual(['timeout'])   // the sharer that succeeded reports nothing
  })

  // The abort variant of this scenario is suppressed — onError does not fire
  // for kind: 'abort'. See tests/on-error.test.ts for that coverage.
  it("does not report a sharer's own abort to onError", async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const kinds: (string | undefined)[] = []
    const api = createApi({
      baseUrl: '',
      onError: e => { kinds.push(e.kind) },
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) },
    })

    const ac = new AbortController()
    const cancelled = api.get({ id: '1' }, { signal: ac.signal })
    api.get({ id: '1' })
    await flush()
    ac.abort()

    expect((await cancelled).error?.kind).toBe('abort')
    expect(kinds).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // A caller that gives up while waiting on a shared round trip is released by
  // ShareTracker.run, which rejects with that caller's own signal reason, and
  // core's catch classifies it by provenance: our signal aborted, so it is our
  // cancellation, whatever shape the reason has. A custom reason
  // (`ac.abort(new Error('x'))`) is not recognised by abortKind's name check,
  // so it falls to the `?? 'abort'` default — never through to 'network'.
  // ---------------------------------------------------------------------------
  it("classifies a sharer's own custom abort reason as abort, not network", async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const ac = new AbortController()
    const p = api.get({ id: '1' }, { signal: ac.signal })
    await flush()
    ac.abort(new Error('component unmounted'))
    const r = await p
    expect(r.error?.kind).toBe('abort')
    expect(r.error?.body).toBeInstanceOf(Error)
  })

  // ---------------------------------------------------------------------------
  // I2: RequestConfig.timeout is a property of the request itself, so under
  // share it bounds the one shared round trip, measured from when it was sent
  // — however patient any single caller is. Applying it per caller from each
  // caller's own join time once let a steady arrival of joiners hold one
  // socket open: measured at 1086ms against a configured 100ms deadline.
  // ---------------------------------------------------------------------------
  it('bounds the shared operation with the per-request timeout, even for a more patient caller', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = createApi({
      baseUrl: '',
      requests: {
        get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true, timeout: 30 }),
      },
    })

    // This caller asks for far more patience than the request allows. Its own
    // budget bounds only itself; it cannot extend the request's deadline.
    const started = Date.now()
    const r = await api.get({ id: '1' }, { timeout: 2000 })

    expect(r.error?.kind).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(1000)
    expect(f.calls[0].aborted()).toBe(true)   // the shared request itself was cut off
  })

  it('coalesces a string-param endpoint', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    // `Request<TParams extends object, ...>` cannot name `string` itself — a
    // raw string body is a runtime-only concept — so the call site casts past
    // the declared (but here vacuous) `Record<string, never>` params type.
    const api = createApi({
      baseUrl: '',
      requests: { search: new Request<Record<string, never>, { ok: number }>({ method: 'POST', path: '/search', share: true }) },
    })
    const all = Promise.all([
      api.search('needle' as unknown as Record<string, never>),
      api.search('needle' as unknown as Record<string, never>),
    ])
    await flush()
    expect(f.fn.mock.calls.length).toBe(1)
    f.calls[0].resolve()
    const results = await all
    expect(results.every(r => r.error === null)).toBe(true)
  })

  it('does not let a late joiner extend the shared operation deadline', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = createApi({
      baseUrl: '',
      requests: {
        get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true, timeout: 100 }),
      },
    })

    const started = Date.now()
    const first = api.get({ id: '1' })
    await flush()
    await new Promise(r => setTimeout(r, 60))

    // Joins the request already in flight, 60ms into its 100ms budget. Its own
    // generous per-call budget must not keep that socket alive past the
    // request's deadline.
    const late = api.get({ id: '1' }, { timeout: 2000 })
    await flush()
    expect(f.fn.mock.calls.length).toBe(1)    // still one shared request

    const [a, b] = await Promise.all([first, late])
    expect(a.error?.kind).toBe('timeout')
    expect(b.error?.kind).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(1000)
  })

  // ---------------------------------------------------------------------------
  // A middleware may replace ctx.request.signal (a per-attempt timeout is the
  // documented pattern). Under share, a caller is tied to the signal its
  // pipeline hands to core, so when that signal fires only that caller gives
  // up; the shared request is governed by its own refcount and deadline, not
  // by any caller's signal, and keeps going for everyone else.
  // ---------------------------------------------------------------------------
  it("keeps the shared request going for the others when one caller's middleware-installed signal fires", async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const installed: AbortController[] = []
    const replacesSignal: Middleware = (ctx, next) => {
      const c = new AbortController()
      installed.push(c)
      ctx.request.signal = c.signal
      return next()
    }
    const api = createApi({
      baseUrl: '',
      requests: {
        get: new Request<{ id: string }, { ok: number }>({
          method: 'GET', path: '/x/:id', share: true, middleware: [replacesSignal],
        }),
      },
    })

    const a = api.get({ id: '1' })
    const b = api.get({ id: '1' })
    await flush()
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect(installed).toHaveLength(2)

    installed[0].abort(new DOMException('per-attempt deadline', 'TimeoutError'))
    const ra = await within(a)
    expect(ra).not.toBe('hung')
    expect((ra as Awaited<typeof a>).error?.kind).toBe('timeout')
    expect(f.calls[0].aborted()).toBe(false)

    f.calls[0].resolve()
    expect((await b).error).toBeNull()
  })

  // The other half of the same contract: the refcount still sees every caller
  // leave, through whatever signal each one's middleware installed, and only
  // then cancels the request — nobody is left waiting on an open socket.
  it("abandons the shared request once every caller's middleware-installed signal has fired", async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const installed: AbortController[] = []
    const replacesSignal: Middleware = (ctx, next) => {
      const c = new AbortController()
      installed.push(c)
      ctx.request.signal = c.signal
      return next()
    }
    const api = createApi({
      baseUrl: '',
      requests: {
        get: new Request<{ id: string }, { ok: number }>({
          method: 'GET', path: '/x/:id', share: true, middleware: [replacesSignal],
        }),
      },
    })

    const a = api.get({ id: '1' })
    const b = api.get({ id: '1' })
    await flush()
    installed[0].abort()
    expect(await within(a)).not.toBe('hung')
    expect(f.calls[0].aborted()).toBe(false)
    installed[1].abort()
    expect(await within(b)).not.toBe('hung')
    expect(f.calls[0].aborted()).toBe(true)
    expect(f.calls[0].reason()).toBe(ABANDONED)
  })

  it('keys a shared call by headers a global middleware adds (the cross-user fix)', async () => {
    // On a server one client serves every user, and an auth middleware adds
    // the current user's identity. Sharing is decided after that middleware
    // ran, on what is actually sent, so two users never share a request and
    // neither ever receives the other's response.
    let user = 'alice'
    const addUser: Middleware = (ctx, next) => {
      ctx.request.headers.set('x-user', user)
      return next()
    }
    const mock = vi.fn(async (_url: string, init: RequestInit) => {
      await new Promise(r => setTimeout(r, 10))
      return new Response(JSON.stringify({ for: new Headers(init.headers).get('x-user') }), {
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', mock)
    const api = createApi({
      baseUrl: 'https://x.test',
      middleware: [addUser],
      requests: { me: new Request<Record<string, never>, { for: string }>({ method: 'GET', path: '/me', share: true }) },
    })
    const a = api.me()
    user = 'bob'
    const b = api.me()
    const [ra, rb] = await Promise.all([a, b])
    expect(mock).toHaveBeenCalledTimes(2)
    expect(ra.data).toEqual({ for: 'alice' })
    expect(rb.data).toEqual({ for: 'bob' })
  })
})

// ---------------------------------------------------------------------------
// Fix 1 (2.2.1, "Duplicate onError under share"): every way a shared call can
// end must produce exactly the reports an equivalent non-shared call would.
// Since 5.1.0 a caller's own give-up is reported by its own pipeline, and a
// failure of the shared round trip is tagged with that round trip's token so
// onError hears about it once. Target counts:
//
//   1 caller,  share, times out           -> 1
//   2 callers, share, both abort          -> 0 (abort is never reported)
//   2 callers, share, both time out       -> 2 (one each)
//   3 sharers, shared request 500s        -> 1
//   non-shared, times out                 -> 1
// ---------------------------------------------------------------------------
describe('duplicate onError under share (Fix 1, 2.2.1)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('row 1: reports exactly once when the lone sharer times out', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const kinds: (string | undefined)[] = []
    const api = createApi({
      baseUrl: '',
      onError: e => { kinds.push(e.kind) },
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) },
    })

    const r = await api.get({ id: '1' }, { timeout: 20 })
    expect(r.error?.kind).toBe('timeout')

    await flush()
    expect(kinds).toEqual(['timeout'])
  })

  // The abort variant of this scenario is suppressed — onError does not fire
  // for kind: 'abort'. See tests/on-error.test.ts for that coverage, and row
  // 2b below for the timeout-driven twin that keeps the once-per-caller count
  // pinned for multiple callers.
  it('row 2: reports once per caller when two sharers both abort', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const kinds: (string | undefined)[] = []
    const api = createApi({
      baseUrl: '',
      onError: e => { kinds.push(e.kind) },
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) },
    })

    const a1 = new AbortController()
    const a2 = new AbortController()
    const a = api.get({ id: '1' }, { signal: a1.signal })
    const b = api.get({ id: '1' }, { signal: a2.signal })
    await flush()
    expect(f.fn).toHaveBeenCalledTimes(1)

    a1.abort()
    expect((await a).error?.kind).toBe('abort')

    a2.abort()
    expect((await b).error?.kind).toBe('abort')

    await flush()
    expect(kinds).toEqual([])
  })

  it('row 2b: reports once per caller when two sharers both time out', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const kinds: (string | undefined)[] = []
    const api = createApi({
      baseUrl: '',
      onError: e => { kinds.push(e.kind) },
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) },
    })

    const a = api.get({ id: '1' }, { timeout: 10 })
    const b = api.get({ id: '1' }, { timeout: 10 })

    expect((await a).error?.kind).toBe('timeout')
    expect((await b).error?.kind).toBe('timeout')
    expect(f.fn).toHaveBeenCalledTimes(1)

    await flush()
    expect(kinds).toEqual(['timeout', 'timeout']) // one report per caller, not three
  })

  it('row 3 (unchanged): reports exactly once when the shared request itself 500s for 3 sharers', async () => {
    const kinds: (string | undefined)[] = []
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const api = createApi({
      baseUrl: '',
      onError: e => { kinds.push(e.kind) },
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) },
    })

    const all = await Promise.all([api.get({ id: '1' }), api.get({ id: '1' }), api.get({ id: '1' })])
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(all.every(r => r.error?.kind === 'http')).toBe(true)

    await flush()
    expect(kinds).toEqual(['http'])
  })

  it('row 4 (unchanged): reports exactly once for a non-shared timeout', async () => {
    const kinds: (string | undefined)[] = []
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      const s = init.signal as AbortSignal | undefined
      if (s?.aborted) { rej(s.reason); return }
      s?.addEventListener('abort', () => rej(s.reason))
    })))
    const api = createApi({
      baseUrl: '',
      onError: e => { kinds.push(e.kind) },
      // No `share` — the plain execute() path.
      requests: { get: new Request<Record<string, never>, unknown>({ method: 'GET', path: '/slow', timeout: 20 }) },
    })

    const r = await api.get()
    expect(r.error?.kind).toBe('timeout')

    await flush()
    expect(kinds).toEqual(['timeout'])
  })

  // ---------------------------------------------------------------------------
  // Row 5: the last caller gives up, which abandons the shared round trip.
  // That caller's own give-up is its own failure and reports once; the
  // abandoned fetch then fails too (here the way some fetch polyfills do, with
  // a TypeError rather than the abort reason, which on its own would classify
  // as 'network'), but nobody is waiting on it any more and it must report
  // nothing. A timeout drives the give-up because onError never fires for
  // 'abort', which would make zero reports indistinguishable from a defect.
  // ---------------------------------------------------------------------------
  it("row 5: reports only the last caller's own give-up, never the fetch it abandoned", async () => {
    const kinds: (string | undefined)[] = []
    let sent: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      sent = init.signal as AbortSignal
      sent.addEventListener('abort', () => rej(new TypeError('Failed to fetch')), { once: true })
    })))
    const api = createApi({
      baseUrl: '',
      onError: e => { kinds.push(e.kind) },
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) },
    })

    const r = await api.get({ id: '1' }, { timeout: 10 }) // the only (thus last) caller
    expect(r.error?.kind).toBe('timeout')
    expect(sent?.reason).toBe(ABANDONED)

    await flush()
    expect(kinds).toEqual(['timeout']) // exactly one report: the caller's own
  })

  // ---------------------------------------------------------------------------
  // Row 6: a cacheMiddleware hit answers before core, so it never reaches the
  // share step: nothing is shared and the hit is this caller's own answer.
  // An abort landing right after the call does not override it — the backstop
  // gives a chain that answers promptly its own answer, exactly as for an
  // unshared call — so there is nothing to report.
  // ---------------------------------------------------------------------------
  it('row 6: a cacheMiddleware hit never reaches core, so nothing is shared and nothing is reported', async () => {
    const kinds: (string | undefined)[] = []
    const cache = cacheMiddleware({ ttl: 60_000 })
    const fetchMock = vi.fn(async () => new Response('{"ok":1}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const api = createApi({
      baseUrl: '',
      onError: e => { kinds.push(e.kind) },
      requests: {
        get: new Request<{ id: string }, { ok: number }>({
          method: 'GET', path: '/x/:id', share: true, middleware: [cache],
        }),
      },
    })

    // Warm the cache with an ordinary, uncontested call.
    await api.get({ id: '1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const ac = new AbortController()
    const p = api.get({ id: '1' }, { signal: ac.signal })
    ac.abort(new DOMException('The operation timed out.', 'TimeoutError'))

    const r = await p
    expect(r.error).toBeNull()
    expect(r.data).toEqual({ ok: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)    // still a cache hit, no second network call

    await flush()
    expect(kinds).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Fix 2 (2.2.1, "cross-kind double report"): a caller that has already given
// up must not be reported again when the shared round trip it left later
// fails — and that failure must still reach onError, once, for the caller
// that was still waiting. Measured on 2.2.0 with two callers:
// ['abort','network','network'].
//
// The give-up uses a TimeoutError reason so that its own report is visible:
// with a plain abort it would be dropped by the abort rule and the count could
// not tell "reported once" from "reported never".
// ---------------------------------------------------------------------------
describe('cross-kind double report on a stale rejection handler (Fix 2, 2.2.1)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('does not report again for a caller that already gave up when the shared fetch later fails', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const kinds: (string | undefined)[] = []
    const api = createApi({
      baseUrl: '',
      onError: e => { kinds.push(e.kind) },
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) },
    })

    const ac = new AbortController()
    const gaveUp = api.get({ id: '1' }, { signal: ac.signal })
    const patient = api.get({ id: '1' }) // keeps the shared request alive
    await flush()
    expect(f.fn).toHaveBeenCalledTimes(1)

    ac.abort(new DOMException('gave up', 'TimeoutError'))
    expect((await gaveUp).error?.kind).toBe('timeout')
    await flush()
    expect(kinds).toEqual(['timeout'])

    // Now the shared round trip fails.
    f.calls[0].reject(new TypeError('Failed to fetch'))
    expect((await patient).error?.kind).toBe('network')

    await flush()
    expect(kinds).toEqual(['timeout', 'network']) // nothing more for the caller that left
  })
})

// ---------------------------------------------------------------------------
// I1: when every caller has abandoned the shared round trip, its own failure
// is nobody's failure and must not be reported. Both callers give up with a
// plain abort (never reported), the last one abandons the fetch, and the
// fetch then fails with an error that would classify as 'network' for anyone
// still waiting. Nobody is: ShareTracker.run has already released both
// callers, so the outcome reaches no pipeline and onError stays silent.
// ---------------------------------------------------------------------------
describe('abandoned shared request reports nothing (I1)', () => {
  afterEach(() => vi.restoreAllMocks())

  it("suppresses the shared operation's own failure when both sharers abandon it", async () => {
    const kinds: (string | undefined)[] = []
    let sent: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      sent = init.signal as AbortSignal
      sent.addEventListener('abort', () => rej(new Error('shared request abandoned')), { once: true })
    })))
    const api = createApi({
      baseUrl: '',
      onError: e => { kinds.push(e.kind) },
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) },
    })

    const a1 = new AbortController()
    const a2 = new AbortController()
    const a = api.get({ id: '1' }, { signal: a1.signal })
    const b = api.get({ id: '1' }, { signal: a2.signal })
    await flush()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)

    a1.abort()
    expect((await a).error?.kind).toBe('abort')

    a2.abort() // last caller leaves: the round trip is abandoned
    expect((await b).error?.kind).toBe('abort')
    expect(sent?.reason).toBe(ABANDONED)

    await flush()
    expect(kinds).toEqual([]) // the abandoned fetch's own failure is not reported
  })
})

// ---------------------------------------------------------------------------
// I2: a consumer that reacts to the shared failure by giving up on its other
// outstanding calls from *inside* onError — cancelling the rest of a batch on
// the first failure. A TimeoutError reason is used because onError does not
// drop 'timeout'. Every caller's error is derived from the one shared round
// trip and carries its token, so the first report covers them all; the
// post-settlement aborts change nothing and add no report.
// ---------------------------------------------------------------------------
describe('a post-settlement self-abort from inside onError (I2)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('does not let a caller aborting itself from inside onError re-report after the shared operation already settled', async () => {
    const kinds: (string | undefined)[] = []
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const ac1 = new AbortController()
    const ac2 = new AbortController()
    const api = createApi({
      baseUrl: '',
      onError: e => {
        kinds.push(e.kind)
        // Simulates a consumer that reacts to the shared failure by giving up
        // on both of its own outstanding calls, synchronously, from inside
        // the handler — e.g. cancelling the rest of a batch on first failure.
        if (e.kind === 'http') {
          ac1.abort(new DOMException('t', 'TimeoutError'))
          ac2.abort(new DOMException('t', 'TimeoutError'))
        }
      },
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) },
    })

    const a = api.get({ id: '1' }, { signal: ac1.signal })
    const b = api.get({ id: '1' }, { signal: ac2.signal })

    await Promise.all([a, b])
    await flush()

    expect(kinds).toEqual(['http']) // the post-settlement self-aborts are not re-reported
  })
})

describe('share decides on what is sent (5.1.0)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('gives every caller its own Result and its own data object', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const all = Promise.all([api.get({ id: '1' }), api.get({ id: '1' })])
    await flush()
    expect(f.fn).toHaveBeenCalledTimes(1)
    f.calls[0].resolve()
    const [a, b] = await all
    expect(a).not.toBe(b)
    expect(a.data).not.toBe(b.data)
    expect(a.data).toEqual(b.data)
  })

  it('shares calls with identical per-call headers, not different ones', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const same = Promise.all([api.get({ id: '1' }, { headers: { 'x-tenant': 'a' } }), api.get({ id: '1' }, { headers: { 'x-tenant': 'a' } })])
    await flush()
    expect(f.fn).toHaveBeenCalledTimes(1)
    f.calls[0].resolve(); await same
    const diff = Promise.all([api.get({ id: '1' }, { headers: { 'x-tenant': 'a' } }), api.get({ id: '1' }, { headers: { 'x-tenant': 'b' } })])
    await flush()
    expect(f.fn).toHaveBeenCalledTimes(3)
    f.calls[1].resolve(); f.calls[2].resolve(); await diff
  })

  it("shares calls that differ only in a tracing header, sending the first caller's value", async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const all = Promise.all([api.get({ id: '1' }, { headers: { 'x-request-id': 'one' } }), api.get({ id: '1' }, { headers: { 'x-request-id': 'two' } })])
    await flush()
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect(new Headers(f.fn.mock.calls[0][1].headers).get('x-request-id')).toBe('one')
    f.calls[0].resolve(); await all
  })

  it("runs every caller's middleware", async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    let count = 0
    const counter: Middleware = (_ctx, next) => { count++; return next() }
    const api = createApi({ baseUrl: '', middleware: [counter], requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) } })
    const all = Promise.all([api.get({ id: '1' }), api.get({ id: '1' }), api.get({ id: '1' })])
    await flush()
    expect(count).toBe(3)
    expect(f.fn).toHaveBeenCalledTimes(1)
    f.calls[0].resolve(); await all
  })

  it('a per-call middleware that changes nothing still shares; one that adds a header splits', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const noop: Middleware = (_ctx, next) => next()
    const tag: Middleware = (ctx, next) => { ctx.request.headers.set('x-flag', '1'); return next() }
    const a = Promise.all([api.get({ id: '1' }, { middleware: [noop] }), api.get({ id: '1' })])
    await flush(); expect(f.fn).toHaveBeenCalledTimes(1); f.calls[0].resolve(); await a
    const b = Promise.all([api.get({ id: '1' }, { middleware: [tag] }), api.get({ id: '1' })])
    await flush(); expect(f.fn).toHaveBeenCalledTimes(3); f.calls[1].resolve(); f.calls[2].resolve(); await b
  })

  it("one caller's middleware mutating data leaves the other's untouched", async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const mutate: Middleware = async (_ctx, next) => {
      const r = await next()
      if (r.data) (r.data as Record<string, unknown>).touched = true
      return r
    }
    const all = Promise.all([api.get({ id: '1' }, { middleware: [mutate] }), api.get({ id: '1' })])
    await flush(); expect(f.fn).toHaveBeenCalledTimes(1); f.calls[0].resolve()
    const [a, b] = await all
    expect(a.data).toHaveProperty('touched', true)
    expect(b.data).not.toHaveProperty('touched')
  })

  it("retry() on a joined caller uses that caller's own headers", async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const all = Promise.all([api.get({ id: '1' }, { headers: { 'x-request-id': 'first' } }), api.get({ id: '1' }, { headers: { 'x-request-id': 'second' } })])
    await flush(); expect(f.fn).toHaveBeenCalledTimes(1); f.calls[0].resolve()
    const [, b] = await all
    const again = b.retry()
    await flush()
    expect(new Headers(f.fn.mock.calls[1][1].headers).get('x-request-id')).toBe('second')
    f.calls[1].resolve(); await again
  })

  it("retry() on a joined caller uses that caller's own signal", async () => {
    // Both retries share one round trip again; cancelling B's own signal ends
    // B's retry alone, and A's retry still gets its answer.
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const bc = new AbortController()
    const all = Promise.all([api.get({ id: '1' }), api.get({ id: '1' }, { signal: bc.signal })])
    await flush(); expect(f.fn).toHaveBeenCalledTimes(1); f.calls[0].resolve()
    const [a, b] = await all
    expect(wasJoined(b)).toBe(true)
    const retries = Promise.all([a.retry(), b.retry()])
    await flush()
    expect(f.fn).toHaveBeenCalledTimes(2)
    bc.abort()
    await flush()
    expect(f.calls[1].aborted()).toBe(false)
    f.calls[1].resolve()
    const [ra, rb] = await retries
    expect(rb.error?.kind).toBe('abort')
    expect(ra.error).toBeNull()
  })

  it('does not share the same query in a different order: the URL is compared as sent', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = createApi({ baseUrl: '', requests: { find: new Request<{ a: number; b: number }, { ok: number }>({ method: 'GET', path: '/q', share: true }) } })
    const all = Promise.all([api.find({ a: 1, b: 2 }), api.find({ b: 2, a: 1 })])
    await flush()
    expect(f.fn.mock.calls.map(c => c[0])).toEqual(['/q?a=1&b=2', '/q?b=2&a=1'])
    f.calls[0].resolve(); f.calls[1].resolve(); await all
  })

  it('does not share JSON bodies with the same content in a different key order', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = createApi({ baseUrl: '', requests: { save: new Request<{ a: number; b: number }, { ok: number }>({ method: 'POST', path: '/save', share: true }) } })
    const all = Promise.all([api.save({ a: 1, b: 2 }), api.save({ b: 2, a: 1 })])
    await flush()
    expect(f.fn).toHaveBeenCalledTimes(2)
    f.calls[0].resolve(); f.calls[1].resolve(); await all
  })

  it('hands both blob callers the same Blob after one fetch', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(r => setTimeout(() => r(new Response(new Blob(['bytes']))), 10)))
    vi.stubGlobal('fetch', fetchMock)
    const api = createApi({ baseUrl: '', requests: { file: new Request<Record<string, never>, Blob>({ method: 'GET', path: '/f', share: true, responseType: 'blob' }) } })
    const [a, b] = await Promise.all([api.file(), api.file()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a.data).toBeInstanceOf(Blob)
    expect(b.data).toBe(a.data)
  })

  it('own abort racing the shared answer: one Result each, no report', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const onError = vi.fn()
    const api = createApi({ baseUrl: '', onError, requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) } })
    const ac = new AbortController()
    const a = api.get({ id: '1' }, { signal: ac.signal })
    const b = api.get({ id: '1' })
    await flush()
    f.calls[0].resolve()
    queueMicrotask(() => ac.abort())
    const [ra, rb] = await Promise.all([a, b])
    expect(ra.error === null || ra.error.kind === 'abort').toBe(true)
    expect(rb.error).toBeNull()
    await flush()
    expect(onError).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // The failure twin of the row above: a caller's own give-up landing in the
  // same tick as a shared FAILURE. The caller that already holds the shared
  // answer keeps it — and that answer is still the one shared failure, which
  // must report once, not once more because the caller's signal has aborted
  // by the time its Result is stamped. The validator is the test's device for
  // landing the abort at exactly that point, deterministically: it runs after
  // the round trip has answered, inside the first caller's own pipeline, and
  // aborts that caller's signal (with a TimeoutError, which onError does not
  // drop) before refusing the value.
  // ---------------------------------------------------------------------------
  it('own give-up landing after a shared failure has answered: the failure still reports once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":1}', { status: 200 })))
    const ac = new AbortController()
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: () => {
          if (!ac.signal.aborted) ac.abort(new DOMException('gave up', 'TimeoutError'))
          return { issues: [{ message: 'refused' }] }
        },
      },
    }
    const kinds: string[] = []
    const api = createApi({
      baseUrl: '',
      onError: e => { kinds.push(e.kind) },
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true, schema }) },
    })
    const [a, b] = await Promise.all([api.get({ id: '1' }, { signal: ac.signal }), api.get({ id: '1' })])
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(ac.signal.aborted).toBe(true)
    expect(a.error?.kind).toBe('parse')
    expect(b.error?.kind).toBe('parse')
    await flush()
    expect(kinds).toEqual(['parse'])
  })

  // The same race swept across every point it can land, for both shapes of
  // shared failure: a 500 (decoded per caller) and a network failure (thrown
  // into each caller's catch). Whatever the interleaving, the shared failure
  // reports exactly once, and the caller's own give-up reports only when that
  // is what the caller ended with. A sweep rather than one fixed offset, so it
  // keeps covering the window when the pipeline's microtask count changes.
  it('own give-up racing a shared failure, at any offset: the failure reports once, the give-up only as itself', async () => {
    for (const failure of ['http', 'network'] as const) {
      for (let k = 0; k < 24; k++) {
        let answer!: () => void
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((res, rej) => {
          answer = failure === 'http'
            ? () => res(new Response('{}', { status: 500 }))
            : () => rej(new TypeError('Failed to fetch'))
        })))
        const kinds: string[] = []
        const api = createApi({
          baseUrl: '',
          onError: e => { kinds.push(e.kind) },
          requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) },
        })
        const ac = new AbortController()
        const a = api.get({ id: '1' }, { signal: ac.signal })
        const b = api.get({ id: '1' })
        await flush()
        answer()
        let p: Promise<unknown> = Promise.resolve()
        for (let i = 0; i < k; i++) p = p.then(() => {})
        void p.then(() => ac.abort(new DOMException('gave up', 'TimeoutError')))
        const [ra, rb] = await Promise.all([a, b])
        await flush()
        const at = `${failure}, k=${k}: ${kinds.join(',')}`
        expect(rb.error?.kind, at).toBe(failure)
        expect(kinds.filter(x => x === failure), at).toHaveLength(1)
        expect(kinds.filter(x => x === 'timeout'), at).toHaveLength(ra.error?.kind === 'timeout' ? 1 : 0)
      }
    }
  })

  it("a caller's middleware-installed signal releases only that caller", async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const quick: Middleware = (ctx, next) => { ctx.request.signal = AbortSignal.timeout(20); return next() }
    const all = Promise.all([api.get({ id: '1' }, { middleware: [quick] }), api.get({ id: '1' })])
    await flush(); expect(f.fn).toHaveBeenCalledTimes(1)
    await new Promise(r => setTimeout(r, 40))
    expect(f.calls[0].aborted()).toBe(false)
    f.calls[0].resolve()
    const [a, b] = await all
    expect(a.error?.kind).toBe('timeout')
    expect(b.error).toBeNull()
  })

  it('marks exactly one of two shared Results as joined', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = shared()
    const all = Promise.all([api.get({ id: '1' }), api.get({ id: '1' })])
    await flush(); f.calls[0].resolve()
    const rs = await all
    expect(rs.filter(r => wasJoined(r))).toHaveLength(1)
  })

  // ---------------------------------------------------------------------------
  // The client-level timeout is the shared request's deadline when the
  // endpoint sets none (spec §6.3). Both callers opt out of their own
  // deadlines with `timeout: 0`, which stops the call → endpoint → client
  // fallback for their own pipelines, so the only thing that can end the hung
  // round trip is the shared request's deadline. Both errors are derived from
  // that one round trip, carry its token, and are reported once.
  // ---------------------------------------------------------------------------
  it('bounds a shared request with no endpoint timeout by the client timeout', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const kinds: string[] = []
    const api = createApi({
      baseUrl: '',
      timeout: 20,
      onError: e => { kinds.push(e.kind) },
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) },
    })
    let timer!: ReturnType<typeof setTimeout>
    const hung = new Promise<'hung'>(r => { timer = setTimeout(() => r('hung'), 500) })
    const settled = await Promise.race([
      Promise.all([api.get({ id: '1' }, { timeout: 0 }), api.get({ id: '1' }, { timeout: 0 })]),
      hung,
    ])
    clearTimeout(timer)
    expect(settled).not.toBe('hung')
    const [a, b] = settled as Awaited<ReturnType<typeof api.get>>[]
    expect(a.error?.kind).toBe('timeout')
    expect(b.error?.kind).toBe('timeout')
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect((f.calls[0].reason() as Error).name).toBe('TimeoutError')
    await flush()
    expect(kinds).toEqual(['timeout'])
  })

  // ---------------------------------------------------------------------------
  // Classification by provenance, mapped onto the shared request. An unshared
  // call whose own signal aborted classifies by that signal's reason, whatever
  // fetch rejected with; whatwg-fetch (React Native's fetch) rejects every
  // abort with its own DOMException('Aborted', 'AbortError'). The shared
  // request's signal is not any caller's, so the share step checks it itself:
  // without that, a shared deadline would read as 'abort' here — and an abort
  // is never reported.
  // ---------------------------------------------------------------------------
  it("classifies the shared deadline as 'timeout' even when fetch rejects with its own AbortError", async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')), { once: true })
    })))
    const kinds: string[] = []
    const api = createApi({
      baseUrl: '',
      onError: e => { kinds.push(e.kind) },
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true, timeout: 20 }) },
    })
    // `timeout: 0` takes the callers' own budgets out of the race, so the
    // shared deadline is what ends the request.
    const [a, b] = await Promise.all([api.get({ id: '1' }, { timeout: 0 }), api.get({ id: '1' }, { timeout: 0 })])
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(a.error?.kind).toBe('timeout')
    expect(b.error?.kind).toBe('timeout')
    expect((a.error?.body as DOMException).name).toBe('AbortError') // what fetch threw, as unshared
    await flush()
    expect(kinds).toEqual(['timeout'])
  })

  // ---------------------------------------------------------------------------
  // Spec §10.1 rows not in the plan's table, on the same code path.
  // ---------------------------------------------------------------------------
  it('does not share two endpoints that hit the same URL', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const api = createApi({
      baseUrl: '',
      requests: {
        asJson: new Request<Record<string, never>, { ok: number }>({ method: 'GET', path: '/same', share: true }),
        asText: new Request<Record<string, never>, string>({ method: 'GET', path: '/same', share: true, responseType: 'text' }),
      },
    })
    const all = Promise.all([api.asJson(), api.asText()])
    await flush()
    expect(f.fn).toHaveBeenCalledTimes(2)
    f.calls[0].resolve(); f.calls[1].resolve()
    const [j, t] = await all
    expect(j.data).toEqual({ ok: 1 })
    expect(t.data).toBe('{"ok":1}')
  })

  it("reports separately a caller whose own middleware turns the shared failure into a different error", async () => {
    const kinds: string[] = []
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const api = createApi({
      baseUrl: '',
      onError: e => { kinds.push(e.kind) },
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) },
    })
    const convert: Middleware = async (_ctx, next) => {
      const r = await next()
      if (r.error) throw new Error('converted by this caller')
      return r
    }
    const [a, b, c] = await Promise.all([
      api.get({ id: '1' }, { middleware: [convert] }),
      api.get({ id: '1' }),
      api.get({ id: '1' }),
    ])
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(a.error?.kind).toBe('middleware')
    expect(b.error?.kind).toBe('http')
    expect(c.error?.kind).toBe('http')
    await flush()
    expect([...kinds].sort()).toEqual(['http', 'middleware'])
  })

  it('a retry joins an identical retry already in flight, but never a finished one', async () => {
    // Option B (spec §3.4): a retry is just another call into core. Two
    // callers that get the same 503 and retry at the same moment share the
    // retry; a caller retrying after that retry has settled sends its own.
    let n = 0
    const fetchMock = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 5))
      return n++ === 0 ? new Response('{}', { status: 503 }) : new Response('{"ok":1}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const retryOnce = (wait: number): Middleware => async (_ctx, next) => {
      const r = await next()
      if (r.error?.status !== 503) return r
      if (wait > 0) await new Promise(res => setTimeout(res, wait))
      return next()
    }
    const api = shared()

    const aligned = await Promise.all([
      api.get({ id: '1' }, { middleware: [retryOnce(0)] }),
      api.get({ id: '1' }, { middleware: [retryOnce(0)] }),
    ])
    expect(aligned.every(r => r.error === null)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2) // one 503, one shared retry

    n = 0
    const apart = await Promise.all([
      api.get({ id: '1' }, { middleware: [retryOnce(0)] }),
      api.get({ id: '1' }, { middleware: [retryOnce(40)] }),
    ])
    expect(apart.every(r => r.error === null)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(5) // one 503, then a retry each
  })
})

// ---------------------------------------------------------------------------
// One report per hung shared request. Every caller's own budget includes the
// endpoint's (or client's) deadline — it has to, so a hung middleware is still
// bounded — and each caller's copy starts no later than the shared request's.
// Under a hung server they all fire at about the same moment, and they are
// one failure: a give-up to that deadline while waiting on a shared request
// carries the round trip's DEADLINE token, as does the shared deadline itself.
// It is a token of its own so that an early timeout can't swallow the report
// of a real failure a caller still waiting receives later.
// ---------------------------------------------------------------------------
describe('one report per hung shared request', () => {
  afterEach(() => vi.restoreAllMocks())

  const timed = (timeout: number, middleware: Middleware[] = []) => {
    const kinds: string[] = []
    const api = createApi({
      baseUrl: '',
      middleware,
      onError: e => { kinds.push(e.kind) },
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true, timeout }) },
    })
    return { api, kinds }
  }

  it('reports a hung shared request once when the callers arrive together', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const { api, kinds } = timed(30)
    const [a, b] = await Promise.all([api.get({ id: '1' }), api.get({ id: '1' })])
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect(a.error?.kind).toBe('timeout')
    expect(b.error?.kind).toBe('timeout')
    await flush()
    expect(kinds).toEqual(['timeout'])
  })

  it('reports a hung shared request once behind an async global middleware', async () => {
    // The middleware delays every caller's send, so every caller's own copy
    // of the deadline starts before the shared request's and fires first.
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const auth: Middleware = async (_ctx, next) => { await Promise.resolve(); return next() }
    const { api, kinds } = timed(30, [auth])
    const [a, b] = await Promise.all([api.get({ id: '1' }), api.get({ id: '1' })])
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect(a.error?.kind).toBe('timeout')
    expect(b.error?.kind).toBe('timeout')
    await flush()
    expect(kinds).toEqual(['timeout'])
  })

  it('still reports a real failure that arrives after a caller timed out', async () => {
    // A starts its deadline 40ms before it sends (its own middleware waits),
    // so it times out at 60ms while the shared request's deadline is not due
    // until about 100ms. The server then answers B with a 500: a different
    // failure, and it reports too.
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const { api, kinds } = timed(60)
    const slowStart: Middleware = async (_ctx, next) => { await new Promise(r => setTimeout(r, 40)); return next() }
    const a = api.get({ id: '1' }, { middleware: [slowStart] })
    await new Promise(r => setTimeout(r, 45))
    const b = api.get({ id: '1' })
    await flush()
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect((await a).error?.kind).toBe('timeout')
    f.calls[0].respond(500)
    expect((await b).error?.kind).toBe('http')
    await flush()
    expect(kinds).toEqual(['timeout', 'http'])
  })

  it('reports once when the client timeout is the only deadline and every caller keeps it', async () => {
    // The companion to "bounds a shared request with no endpoint timeout by
    // the client timeout": no per-call override, so each caller's own budget
    // carries the client's 20ms too, and still one report.
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const kinds: string[] = []
    const api = createApi({
      baseUrl: '',
      timeout: 20,
      onError: e => { kinds.push(e.kind) },
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true }) },
    })
    const [a, b] = await Promise.all([api.get({ id: '1' }), api.get({ id: '1' })])
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect(a.error?.kind).toBe('timeout')
    expect(b.error?.kind).toBe('timeout')
    await flush()
    expect(kinds).toEqual(['timeout'])
  })

  // A response-side middleware that awaits a macrotask after next() (remote
  // logging, an IndexedDB write) outlives the backstop's grace period, so the
  // backstop settles every caller with a Result of its own making. That
  // Result is still the one hung request's deadline, and carries its token.
  const slowAfter = (ms: number): Middleware => async (_ctx, next) => {
    const result = await next()
    await new Promise(r => setTimeout(r, ms))
    return result
  }

  it('reports a hung shared request once when every caller has slow response-side middleware', async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const { api, kinds } = timed(30, [slowAfter(5)])
    const [a, b] = await Promise.all([api.get({ id: '1' }), api.get({ id: '1' })])
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect(a.error?.kind).toBe('timeout')
    expect(b.error?.kind).toBe('timeout')
    // Past the middleware's own late return too, which the backstop discards.
    await new Promise(r => setTimeout(r, 20))
    expect(kinds).toEqual(['timeout'])
  })

  it("still reports per caller a per-call timeout the backstop settles: it is each caller's own", async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const { api, kinds } = timed(0, [slowAfter(5)])
    const [a, b] = await Promise.all([api.get({ id: '1' }, { timeout: 30 }), api.get({ id: '1' }, { timeout: 30 })])
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect(a.error?.kind).toBe('timeout')
    expect(b.error?.kind).toBe('timeout')
    await new Promise(r => setTimeout(r, 20))
    expect(kinds).toEqual(['timeout', 'timeout'])
  })

  it("leaves a caller's timeout its own when the round trip answered and its own middleware ran out the deadline", async () => {
    // The shared request answers 200 at once; each caller's response-side
    // middleware then holds it past the endpoint's deadline. Nothing hung while
    // they waited, so each backstop timeout is that caller's own failure.
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const { api, kinds } = timed(30, [slowAfter(60)])
    const a = api.get({ id: '1' })
    const b = api.get({ id: '1' })
    await flush()
    expect(f.fn).toHaveBeenCalledTimes(1)
    f.calls[0].resolve()
    expect((await a).error?.kind).toBe('timeout')
    expect((await b).error?.kind).toBe('timeout')
    await new Promise(r => setTimeout(r, 70))
    expect(kinds).toEqual(['timeout', 'timeout'])
  })

  it("never lets a caller the backstop settles at the deadline swallow another caller's real failure", async () => {
    // The shared request answers 500. B receives it; A's own response-side
    // middleware is still waiting when the endpoint's deadline passes, so the
    // backstop settles A with 'timeout'. Two failures, two reports: the
    // backstop's Result may carry only the round trip's DEADLINE token.
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const { api, kinds } = timed(30)
    const a = api.get({ id: '1' }, { middleware: [slowAfter(60)] })
    const b = api.get({ id: '1' })
    await flush()
    expect(f.fn).toHaveBeenCalledTimes(1)
    f.calls[0].respond(500)
    expect((await b).error?.kind).toBe('http')
    expect((await a).error?.kind).toBe('timeout')
    await new Promise(r => setTimeout(r, 70))
    expect(kinds).toEqual(['http', 'timeout'])
  })
})

// ---------------------------------------------------------------------------
// A middleware that replaces ctx.request.signal with one that never fires
// must not stop the caller's own cancel from letting go of the round trip:
// the caller waits on its own budget AND the installed signal, and is
// released by whichever fires. Its give-up is classified by that signal, so a
// custom reason stays 'abort' — not 'network', and not reported.
// ---------------------------------------------------------------------------
describe('a replaced signal does not hold the shared request', () => {
  afterEach(() => vi.restoreAllMocks())

  it("releases a caller on its own cancel, and the last one abandons the request", async () => {
    const f = controllable(); vi.stubGlobal('fetch', f.fn)
    const neverFires: Middleware = (ctx, next) => { ctx.request.signal = new AbortController().signal; return next() }
    const onError = vi.fn()
    const api = createApi({
      baseUrl: '',
      onError,
      requests: { get: new Request<{ id: string }, { ok: number }>({ method: 'GET', path: '/x/:id', share: true, middleware: [neverFires] }) },
    })
    const ac1 = new AbortController(), ac2 = new AbortController()
    const a = api.get({ id: '1' }, { signal: ac1.signal })
    const b = api.get({ id: '1' }, { signal: ac2.signal })
    await flush()
    expect(f.fn).toHaveBeenCalledTimes(1)

    ac1.abort(new Error('unmount'))
    const ra = await within(a)
    expect(ra).not.toBe('hung')
    expect((ra as Awaited<typeof a>).error?.kind).toBe('abort')
    expect(f.calls[0].aborted()).toBe(false)

    ac2.abort(new Error('unmount'))
    const rb = await within(b)
    expect((rb as Awaited<typeof b>).error?.kind).toBe('abort')
    expect(f.calls[0].reason()).toBe(ABANDONED)
    await flush()
    expect(onError).not.toHaveBeenCalled()
  })
})
