import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApi, defineRequest, createGraphQL, Operation, gql } from '../src/index.js'
import type { Middleware } from '../src/index.js'
import { logMiddleware, retryMiddleware } from '../src/built-in-middleware.js'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
let log: ReturnType<typeof vi.spyOn>, table: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
  table = vi.spyOn(console, 'table').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const users = [{ id: '1' }, { id: '2' }]
const make = (log?: unknown) => createApi({
  baseUrl: 'https://x.test',
  log: log as never,
  requests: { list: defineRequest<{ id: string }[]>()({ method: 'GET', path: '/users' }) },
})

describe('log option', () => {
  it('is off by default', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(users)))
    await make().list()
    expect(log).not.toHaveBeenCalled()
  })
  it('log: true prints the request and outcome lines', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(users)))
    await make(true).list()
    expect(log.mock.calls[0][0]).toBe('[liaise] → GET list https://x.test/users')
    expect(log.mock.calls[1][0]).toMatch(/^\[liaise\] ← list OK \(\d+ms\)$/)
    expect(table).not.toHaveBeenCalled()
  })
  it('enabled: false is silent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(users)))
    await make({ enabled: false, data: true }).list()
    expect(log).not.toHaveBeenCalled()
  })
  it('data: true prints an object or array with console.table', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(users)))
    await make({ data: true }).list()
    expect(table).toHaveBeenCalledWith(users)
  })
  it('data: true prints an error body on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'nope' }, 404)))
    await make({ data: true }).list()
    expect(log.mock.calls[1][0]).toMatch(/← list ERROR 404/)
    expect(table).toHaveBeenCalledWith({ message: 'nope' })
  })
  it('data: true prints a non-object with console.log, not console.table', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('hello', { status: 200 })))
    const api = createApi({
      baseUrl: 'https://x.test',
      log: { data: true },
      requests: { t: defineRequest<string>()({ method: 'GET', path: '/t', responseType: 'text' }) },
    })
    await api.t()
    expect(log).toHaveBeenCalledWith('hello')
    expect(table).not.toHaveBeenCalled()
  })
  it('falls back to console.log where console.table is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(users)))
    const original = console.table
    ;(console as { table?: unknown }).table = undefined
    try {
      await make({ data: true }).list()
      expect(log).toHaveBeenCalledWith(users)
    } finally { console.table = original }
  })
  it('a throwing console never fails the call', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(users)))
    log.mockImplementation(() => { throw new Error('console broke') })
    const r = await make(true).list()
    expect(r.data).toEqual(users)
  })
  it('tags a call that joined a shared request with ", shared"', async () => {
    let release!: () => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { release = () => r(json(users)) })))
    const api = createApi({ baseUrl: 'https://x.test', log: true, requests: { list: defineRequest<{ id: string }[]>()({ method: 'GET', path: '/users', share: true }) } })
    const a = api.list(); const b = api.list()
    await new Promise(r => setTimeout(r, 0)); release()
    await Promise.all([a, b])
    const outcomes = log.mock.calls.map(c => String(c[0])).filter(l => l.includes('←'))
    expect(outcomes.filter(l => l.endsWith(', shared)'))).toHaveLength(1)
  })
  it('logs once per call with the final outcome, outside the global middleware', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(users)))
    const order: string[] = []
    log.mockImplementation((line: unknown) => { order.push(String(line).slice(0, 10)) })
    const api = createApi({ baseUrl: 'https://x.test', log: true, middleware: [async (ctx, next) => { order.push('mw'); return next() }], requests: { list: defineRequest<{ id: string }[]>()({ method: 'GET', path: '/users' }) } })
    await api.list()
    expect(order[0].startsWith('[liaise] →')).toBe(true)
    expect(order[1]).toBe('mw')
  })
  it('works on createGraphQL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { x: 1 } })))
    const g = createGraphQL({ endpoint: 'https://x.test/graphql', log: true, operations: { getX: new Operation<Record<string, never>, { x: number }>({ operation: gql`query { x }` }) } })
    await g.getX()
    expect(log.mock.calls[0][0]).toBe('[liaise] → POST getX https://x.test/graphql')
  })
  it('data: true prints the data on createGraphQL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { x: 1 } })))
    const g = createGraphQL({ endpoint: 'https://x.test/graphql', log: { data: true }, operations: { getX: new Operation<Record<string, never>, { x: number }>({ operation: gql`query { x }` }) } })
    await g.getX()
    expect(table).toHaveBeenCalledWith({ x: 1 })
  })
  it('tags a GraphQL call that joined a shared operation with ", shared"', async () => {
    let release!: () => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { release = () => r(json({ data: { x: 1 } })) })))
    const g = createGraphQL({ endpoint: 'https://x.test/graphql', log: true, operations: { getX: new Operation<Record<string, never>, { x: number }>({ operation: gql`query { x }`, share: true }) } })
    const a = g.getX(); const b = g.getX()
    await new Promise(r => setTimeout(r, 0)); release()
    await Promise.all([a, b])
    const outcomes = log.mock.calls.map(c => String(c[0])).filter(l => l.includes('←'))
    expect(outcomes).toHaveLength(2)
    expect(outcomes.filter(l => l.endsWith(', shared)'))).toHaveLength(1)
  })
})

// The client's logger is not a middleware: it prints the start line before the
// chain runs and the end line from the post-execution hook, with the Result the
// caller actually receives. So a call the timeout backstop settles — a
// middleware stuck on something the signal does not reach — still logs its
// end, at the deadline, once; and a retried call logs one pair.
describe('log option: one line pair per call, whatever the chain does', () => {
  const ends = () => log.mock.calls.map(c => String(c[0])).filter(l => l.startsWith('[liaise] ←'))
  const stuck: Middleware = () => new Promise(() => {})

  it('prints the end line at the deadline when a middleware never settles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(users)))
    const api = createApi({ baseUrl: 'https://x.test', log: true, timeout: 30, middleware: [stuck], requests: { list: defineRequest<{ id: string }[]>()({ method: 'GET', path: '/users' }) } })
    const r = await api.list()
    expect(r.error?.kind).toBe('timeout')
    const lines = ends()
    expect(lines).toHaveLength(1)
    const ms = Number(/^\[liaise\] ← list ERROR 0 \((\d+)ms\)$/.exec(lines[0])?.[1])
    expect(ms).toBeGreaterThanOrEqual(20)
    expect(ms).toBeLessThan(1000)
  })

  it('prints the end line at the deadline when a middleware never settles, on createGraphQL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { x: 1 } })))
    const g = createGraphQL({ endpoint: 'https://x.test/graphql', log: true, timeout: 30, middleware: [stuck], operations: { getX: new Operation<Record<string, never>, { x: number }>({ operation: gql`query { x }` }) } })
    const r = await g.getX()
    expect(r.error?.kind).toBe('timeout')
    const lines = ends()
    expect(lines).toHaveLength(1)
    const ms = Number(/^\[liaise\] ← getX ERROR 0 \((\d+)ms\)$/.exec(lines[0])?.[1])
    expect(ms).toBeGreaterThanOrEqual(20)
    expect(ms).toBeLessThan(1000)
  })

  it('tags ", shared" on a joined caller the backstop settles: it still sent nothing', async () => {
    // Both callers share one hung request; each one's response-side
    // middleware then waits forever, so the backstop ends both calls.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const stuckAfter: Middleware = async (_ctx, next) => { await next(); return new Promise(() => {}) }
    const api = createApi({ baseUrl: 'https://x.test', log: true, middleware: [stuckAfter], requests: { list: defineRequest<{ id: string }[]>()({ method: 'GET', path: '/users', share: true, timeout: 30 }) } })
    const [a, b] = await Promise.all([api.list(), api.list()])
    expect(a.error?.kind).toBe('timeout')
    expect(b.error?.kind).toBe('timeout')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const lines = ends()
    expect(lines).toHaveLength(2)
    expect(lines.filter(l => l.endsWith(', shared)'))).toHaveLength(1)
  })

  it('logs nothing for a call whose setup fails before anything runs', async () => {
    const fetchMock = vi.fn(async () => json(users)); vi.stubGlobal('fetch', fetchMock)
    const api = createApi({ baseUrl: 'https://x.test', log: true, requests: { get: defineRequest<{ ok: boolean }>()({ method: 'GET', path: '/users/:id' }) } })
    const r = await api.get({ id: undefined as unknown as string }) // a refused path param
    expect(r.error?.kind).toBe('network')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('logs nothing for a GraphQL call whose setup fails before anything runs', async () => {
    const fetchMock = vi.fn(async () => json({ data: { x: 1 } })); vi.stubGlobal('fetch', fetchMock)
    const g = createGraphQL({ endpoint: 'https://x.test/graphql', log: true, operations: { getX: new Operation<{ n: bigint }, { x: number }>({ operation: gql`query X($n: Int) { x(n: $n) }` }) } })
    const r = await g.getX({ n: 1n }) // variables JSON.stringify cannot serialise
    expect(r.error?.kind).toBe('network')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('logs one line pair for a call retryMiddleware retries', async () => {
    const responses = [json({}, 503), json({}, 503), json(users)]
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift()!))
    const api = createApi({ baseUrl: 'https://x.test', log: true, middleware: [retryMiddleware({ max: 2, baseDelay: 1 })], requests: { list: defineRequest<{ id: string }[]>()({ method: 'GET', path: '/users' }) } })
    const r = await api.list()
    expect(r.data).toEqual(users)
    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
    const lines = log.mock.calls.map(c => String(c[0])).filter(l => l.startsWith('[liaise]'))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('[liaise] → GET list https://x.test/users')
    expect(lines[1]).toMatch(/^\[liaise\] ← list OK \(\d+ms\)$/)
  })
})

describe('logMiddleware', () => {
  it('still works bare, as before', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(users)))
    const api = createApi({ baseUrl: 'https://x.test', middleware: [logMiddleware], requests: { list: defineRequest<{ id: string }[]>()({ method: 'GET', path: '/users' }) } })
    await api.list()
    expect(log).toHaveBeenCalledTimes(2)
  })
  it('accepts options', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(users)))
    const quiet = createApi({ baseUrl: 'https://x.test', middleware: [logMiddleware({ enabled: false })], requests: { list: defineRequest<{ id: string }[]>()({ method: 'GET', path: '/users' }) } })
    await quiet.list()
    expect(log).not.toHaveBeenCalled()
    const loud = createApi({ baseUrl: 'https://x.test', middleware: [logMiddleware({ data: true })], requests: { list: defineRequest<{ id: string }[]>()({ method: 'GET', path: '/users' }) } })
    await loud.list()
    expect(table).toHaveBeenCalledWith(users)
  })
})
