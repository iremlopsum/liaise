import { describe, it, expect, vi } from 'vitest'
import { getEventListeners } from 'node:events'
import { ShareTracker, requestKey, TRACING_HEADERS, tagShared, markJoined, wasJoined, ABANDONED } from '../src/utils/share.js'
import type { Exchange } from '../src/utils/exchange.js'

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
  it('normalises case only for the methods Fetch normalises', () => {
    expect(requestKey('x', 'get', '/x', h({}), null)).toBe(requestKey('x', 'GET', '/x', h({}), null))
    expect(requestKey('x', 'patch', '/x', h({}), null)).not.toBe(requestKey('x', 'PATCH', '/x', h({}), null))
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
    for (const body of [new FormData(), new Blob(['a']), new ArrayBuffer(1), new Uint8Array(1), new DataView(new ArrayBuffer(1)), new ReadableStream()]) {
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

  it('a call after settlement is a fresh request, not a join', async () => {
    // Pins a contract held by two redundant guards (settle's map delete and the settled check).
    const t = new ShareTracker()
    const first = await t.run('k', () => undefined, undefined, async () => ex('old'))
    const second = await t.run('k', () => undefined, undefined, async () => ex('fresh'))
    expect(first.joined).toBe(false)
    expect(second.joined).toBe(false)
    expect(second.outcome.ok && second.outcome.exchange.body).toBe('fresh')
  })

  it('rejects an already-aborted caller without sending, and leaves nothing to join', async () => {
    const t = new ShareTracker()
    const ac = new AbortController()
    ac.abort(new Error('early'))
    const send = vi.fn(async () => ex())
    const deadline = vi.fn(() => undefined)
    await expect(t.run('k', deadline, ac.signal, send)).rejects.toThrow('early')
    expect(send).not.toHaveBeenCalled()
    expect(deadline).not.toHaveBeenCalled()
    const next = await t.run('k', () => undefined, undefined, send)
    expect(next.joined).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does not join an entry whose shared deadline has fired', async () => {
    const t = new ShareTracker()
    const limit = new AbortController()
    const send = vi.fn(() => new Promise<Exchange>(() => {}))
    void t.run('k', () => limit.signal, undefined, send)
    limit.abort(new Error('deadline'))
    const second = t.run('k', () => undefined, undefined, send)
    void second
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('does not join a request whose callers have all given up, even if send ignores its signal', async () => {
    const t = new ShareTracker()
    const ac = new AbortController()
    const send = vi.fn(() => new Promise<Exchange>(() => {}))
    const a = t.run('k', () => undefined, ac.signal, send).catch(() => {})
    ac.abort()
    await a
    const fresh = vi.fn(async () => ex())
    // Pins a contract held by redundant guards (abandon delete, refs <= 0, signal.aborted).
    let timer!: ReturnType<typeof setTimeout>
    const guard = new Promise<'hung'>(res => { timer = setTimeout(() => res('hung'), 500) })
    const r = await Promise.race([t.run('k', () => undefined, undefined, fresh), guard])
    clearTimeout(timer)
    expect(r).not.toBe('hung')
    expect((r as { joined: boolean }).joined).toBe(false)
    expect(fresh).toHaveBeenCalledTimes(1)
  })

  it('drops an abandoned entry from the map even if send ignores its signal', async () => {
    const t = new ShareTracker()
    const ac = new AbortController()
    const a = t.run('k', () => undefined, ac.signal, () => new Promise<Exchange>(() => {})).catch(() => {})
    ac.abort()
    await a
    // The map is private; a lingering entry would also keep the key (body text) alive.
    expect((t as unknown as { runs: Map<string, unknown> }).runs.size).toBe(0)
  })

  it('leaves no abort listener on a long-lived caller signal or on the deadline signal', async () => {
    const t = new ShareTracker()
    const ac = new AbortController()
    for (let i = 0; i < 5; i++) await t.run('k', () => undefined, ac.signal, async () => ex())
    expect(getEventListeners(ac.signal, 'abort')).toHaveLength(0)
    const limit = new AbortController()
    await t.run('k', () => limit.signal, ac.signal, async () => ex())
    expect(getEventListeners(limit.signal, 'abort')).toHaveLength(0)
    expect(getEventListeners(ac.signal, 'abort')).toHaveLength(0)
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

  it('applies the deadline once, from the leader, and aborts the shared send with a TimeoutError', async () => {
    const t = new ShareTracker()
    const deadline = vi.fn(() => AbortSignal.timeout(20))
    let sentSignal!: AbortSignal
    const send = (s: AbortSignal) => { sentSignal = s; return new Promise<Exchange>((_, rej) => s.addEventListener('abort', () => rej(s.reason))) }
    const a = t.run('k', deadline, undefined, send)
    const b = t.run('k', deadline, undefined, send)
    let timer!: ReturnType<typeof setTimeout>
    const guard = new Promise<'hung'>(r => { timer = setTimeout(() => r('hung'), 500) })
    const res = await Promise.race([Promise.all([a, b]), guard])
    clearTimeout(timer)
    expect(res).not.toBe('hung')
    const [ra, rb] = res as Awaited<typeof a>[]
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

  it('tells each caller its round trip on entry, before it can give up', async () => {
    const t = new ShareTracker()
    const seen: { token: object; deadlineToken: object; joined: boolean }[] = []
    const ac = new AbortController()
    const send = () => new Promise<Exchange>(() => {})
    const a = t.run('k', () => undefined, ac.signal, send, e => seen.push(e))
    const b = t.run('k', () => undefined, undefined, send, e => seen.push(e))
    // Synchronous: both are known before anything settles.
    expect(seen).toHaveLength(2)
    expect(seen.map(e => e.joined)).toEqual([false, true])
    expect(seen[1].token).toBe(seen[0].token)
    expect(seen[1].deadlineToken).toBe(seen[0].deadlineToken)
    expect(seen[0].deadlineToken).not.toBe(seen[0].token)
    ac.abort(new Error('left'))
    await expect(a).rejects.toThrow('left')
    void b
  })

  it('a throwing onEnter fails that caller alone and leaves nothing behind', async () => {
    const t = new ShareTracker()
    let sentSignal!: AbortSignal
    const hung = vi.fn((s: AbortSignal) => { sentSignal = s; return new Promise<Exchange>(() => {}) })
    let thrown: unknown
    let first: Promise<unknown> | undefined
    try {
      first = t.run('k', () => undefined, undefined, hung, () => { throw new Error('boom') })
    } catch (err) {
      thrown = err
    }
    // A rejection, never a synchronous throw.
    expect(thrown).toBeUndefined()
    await expect(first).rejects.toThrow('boom')
    // Its reference was given back: the request it started was abandoned.
    expect(sentSignal.reason).toBe(ABANDONED)
    // And nothing is left to join.
    const fresh = vi.fn(async () => ex())
    const next = await t.run('k', () => undefined, undefined, fresh)
    expect(next.joined).toBe(false)
    expect(fresh).toHaveBeenCalledTimes(1)
  })

  it('does not call onEnter for a caller that had already given up', async () => {
    const t = new ShareTracker()
    const onEnter = vi.fn()
    await expect(t.run('k', () => undefined, AbortSignal.abort(new Error('gone')), async () => ex(), onEnter)).rejects.toThrow('gone')
    expect(onEnter).not.toHaveBeenCalled()
  })

  it('marks joined results', () => {
    const r = {}
    expect(wasJoined(r)).toBe(false)
    markJoined(r)
    expect(wasJoined(r)).toBe(true)
  })
})
