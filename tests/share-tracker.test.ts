import { describe, it, expect, vi } from 'vitest'
import { ShareTracker, isAbandoned, requestKey, TRACING_HEADERS, tagShared, markJoined, wasJoined, ABANDONED } from '../src/utils/share.js'
import type { Exchange } from '../src/utils/exchange.js'

const never = () => new Promise<never>(() => {})

describe('ShareTracker abandonment', () => {
  it('aborts with an abandonment reason when the last reference releases', async () => {
    const t = new ShareTracker()
    let seen: AbortSignal | undefined
    const { release } = t.acquire('k', s => { seen = s; return never() })
    expect(release()).toBe(true)
    expect(seen!.aborted).toBe(true)
    expect(isAbandoned(seen!.reason)).toBe(true)
  })

  it('does not report abandonment for a non-last release', () => {
    const t = new ShareTracker()
    const a = t.acquire('k', () => never())
    const b = t.acquire('k', () => never())
    expect(a.release()).toBe(false)
    expect(b.release()).toBe(true)
  })

  it('treats an abandoned entry as absent immediately, not a microtask later', () => {
    const t = new ShareTracker()
    let calls = 0
    const first = t.acquire('k', () => { calls++; return never() })
    first.release()
    // No await: the previous entry is dead but its .finally() has not run.
    t.acquire('k', () => { calls++; return never() })
    expect(calls).toBe(2)
  })

  it('a double release returns false the second time', () => {
    const t = new ShareTracker()
    const { release } = t.acquire('k', () => never())
    expect(release()).toBe(true)
    expect(release()).toBe(false)
  })

  it('isAbandoned rejects ordinary abort reasons', () => {
    expect(isAbandoned(new DOMException('x', 'AbortError'))).toBe(false)
    expect(isAbandoned(new DOMException('x', 'TimeoutError'))).toBe(false)
    expect(isAbandoned(undefined)).toBe(false)
  })
})

const ex = (text = 'ok'): Exchange => ({ response: new Response(null, { status: 200 }), body: text, readFailed: false, readError: undefined })
const deferred = <T,>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

describe('requestKey', () => {
  const h = (init: HeadersInit) => new Headers(init)
  it('is equal for identical requests and ignores header order and case', () => {
    expect(requestKey('me', 'GET', '/me', h({ A: '1', b: '2' }), null)).toBe(requestKey('me', 'get', '/me', h({ b: '2', a: '1' }), null))
  })
  it('differs by name, method, url, any header value, or body', () => {
    const base = requestKey('me', 'GET', '/me', h({ authorization: 'Bearer alice' }), null)
    expect(requestKey('me2', 'GET', '/me', h({ authorization: 'Bearer alice' }), null)).not.toBe(base)
    expect(requestKey('me', 'POST', '/me', h({ authorization: 'Bearer alice' }), null)).not.toBe(base)
    expect(requestKey('me', 'GET', '/me?x=1', h({ authorization: 'Bearer alice' }), null)).not.toBe(base)
    expect(requestKey('me', 'GET', '/me', h({ authorization: 'Bearer bob' }), null)).not.toBe(base)
    expect(requestKey('me', 'GET', '/me', h({ authorization: 'Bearer alice' }), '{}')).not.toBe(base)
  })
  it('ignores exactly the tracing headers', () => {
    expect([...TRACING_HEADERS].sort()).toEqual(['baggage', 'sentry-trace', 'traceparent', 'tracestate', 'x-correlation-id', 'x-request-id'])
    const a = requestKey('me', 'GET', '/me', h({ 'x-request-id': 'one', traceparent: 't1' }), null)
    const b = requestKey('me', 'GET', '/me', h({ 'x-request-id': 'two', traceparent: 't2' }), null)
    expect(a).toBe(b)
  })
  it('keys string and URLSearchParams bodies, and refuses every other body', () => {
    expect(requestKey('x', 'POST', '/x', h({}), new URLSearchParams('a=1'))).toBe(requestKey('x', 'POST', '/x', h({}), new URLSearchParams('a=1')))
    expect(requestKey('x', 'POST', '/x', h({}), 'a=1')).not.toBe(requestKey('x', 'POST', '/x', h({}), new URLSearchParams('a=1')))
    for (const body of [new FormData(), new Blob(['a']), new ArrayBuffer(1), new Uint8Array(1), new ReadableStream()]) {
      expect(requestKey('x', 'POST', '/x', h({}), body)).toBeNull()
    }
  })
})

describe('ShareTracker.run (5.1.0)', () => {
  it('sends once for concurrent identical keys and tells joiners they joined', async () => {
    const t = new ShareTracker()
    const d = deferred<Exchange>()
    const send = vi.fn(() => d.promise)
    const a = t.run('k', () => undefined, undefined, send)
    const b = t.run('k', () => undefined, undefined, send)
    d.resolve(ex())
    const [ra, rb] = await Promise.all([a, b])
    expect(send).toHaveBeenCalledTimes(1)
    expect(ra.joined).toBe(false)
    expect(rb.joined).toBe(true)
    expect(ra.token).toBe(rb.token)
    expect(ra.outcome.ok && rb.outcome.ok).toBe(true)
  })

  it('a settled entry is never joined (no caching)', async () => {
    const t = new ShareTracker()
    const send = vi.fn(async () => ex())
    await t.run('k', () => undefined, undefined, send)
    await t.run('k', () => undefined, undefined, send)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('does not join an entry that has settled but is not yet cleaned up', async () => {
    const t = new ShareTracker()
    // Probe the window deterministically: the entry is removed from the map by a
    // cleanup step that runs after its outcome is set, so hook that removal and
    // start a call right before it, while the entry is still in the map.
    const runs = (t as unknown as { runs: Map<string, unknown> }).runs
    let late: Promise<{ joined: boolean }> | undefined
    const del = runs.delete.bind(runs)
    runs.delete = (k: string) => {
      late ??= t.run('k', () => undefined, undefined, async () => ex('fresh'))
      return del(k)
    }
    const send = vi.fn(async () => ex('old'))
    await t.run('k', () => undefined, undefined, send)
    expect((await late)!.joined).toBe(false)
  })

  it('a caller that gives up rejects with its own reason, and the request continues for the others', async () => {
    const t = new ShareTracker()
    const d = deferred<Exchange>()
    let sentSignal!: AbortSignal
    const send = (s: AbortSignal) => { sentSignal = s; return d.promise }
    const ac = new AbortController()
    const a = t.run('k', () => undefined, ac.signal, send)
    const b = t.run('k', () => undefined, undefined, send)
    ac.abort(new Error('mine'))
    await expect(a).rejects.toThrow('mine')
    expect(sentSignal.aborted).toBe(false)
    d.resolve(ex())
    expect((await b).outcome.ok).toBe(true)
  })

  it('aborts the request with ABANDONED when the last caller gives up', async () => {
    const t = new ShareTracker()
    let sentSignal!: AbortSignal
    const ac1 = new AbortController(), ac2 = new AbortController()
    const send = (s: AbortSignal) => { sentSignal = s; return new Promise<Exchange>(() => {}) }
    const a = t.run('k', () => undefined, ac1.signal, send).catch(() => {})
    const b = t.run('k', () => undefined, ac2.signal, send).catch(() => {})
    ac1.abort(); ac2.abort()
    await Promise.all([a, b])
    expect(sentSignal.aborted).toBe(true)
    expect(sentSignal.reason).toBe(ABANDONED)
  })

  it('applies the deadline only from the leader, measured from send', async () => {
    const t = new ShareTracker()
    const deadline = vi.fn(() => AbortSignal.timeout(20))
    let sentSignal!: AbortSignal
    const send = (s: AbortSignal) => { sentSignal = s; return new Promise<Exchange>((_, rej) => s.addEventListener('abort', () => rej(s.reason))) }
    const a = t.run('k', deadline, undefined, send)
    const b = t.run('k', deadline, undefined, send)
    const [ra, rb] = await Promise.all([a, b])
    expect(deadline).toHaveBeenCalledTimes(1)
    expect(ra.outcome.ok || rb.outcome.ok).toBe(false)
    expect((sentSignal.reason as Error).name).toBe('TimeoutError')
  })

  it('turns a rejected send into an outcome, never a rejection', async () => {
    const t = new ShareTracker()
    const r = await t.run('k', () => undefined, undefined, async () => { throw new TypeError('offline') })
    expect(r.outcome.ok).toBe(false)
    expect(!r.outcome.ok && String(r.outcome.error)).toContain('offline')
  })

  it('turns a synchronous throw from send into an outcome, and leaves no entry behind', async () => {
    const t = new ShareTracker()
    const r = await t.run('k', () => undefined, undefined, () => { throw new TypeError('sync boom') })
    expect(r.outcome.ok).toBe(false)
    expect(!r.outcome.ok && String(r.outcome.error)).toContain('sync boom')
    const send = vi.fn(async () => ex())
    await t.run('k', () => undefined, undefined, send)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('reports each shared token once and untagged errors always', () => {
    const t = new ShareTracker()
    const token = {}
    const e1 = {}, e2 = {}, plain = {}
    tagShared(e1, token); tagShared(e2, token)
    expect(t.shouldReport(e1)).toBe(true)
    expect(t.shouldReport(e2)).toBe(false)
    expect(t.shouldReport(plain)).toBe(true)
    expect(t.shouldReport(plain)).toBe(true)
  })

  it('marks joined results', () => {
    const r = {}
    expect(wasJoined(r)).toBe(false)
    markJoined(r)
    expect(wasJoined(r)).toBe(true)
  })
})
