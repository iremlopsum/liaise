import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createApi, defineRequest } from '../../src/index' // the library's source (the playground runs its build)
import { createRunner, instrument, liaiseShim, BRIDGE, type RunHandle, type RunScope } from '../src/playground/runner'
import { createFakeServer, FAKE_ORIGIN, type SentRequest } from '../src/playground/fake-server'

const tick = () => new Promise((r) => setTimeout(r, 0))

function setup(passThrough?: (input: RequestInfo | URL) => boolean) {
  const original = { fetch: vi.fn() as unknown as typeof fetch, log: vi.fn(), error: vi.fn() }
  const scope: RunScope = { fetch: original.fetch, console: { log: original.log, error: original.error } }
  const sent: SentRequest[] = []
  const settled: Array<{ id: number; outcome: unknown }> = []
  const server = createFakeServer({ onRequest: (r) => sent.push(r), onSettle: (s) => settled.push(s) })
  const printed: string[] = []
  const runner = createRunner({ scope, send: server.fetch, passThrough, print: (a, tone) => printed.push(`${tone}: ${a.join(' ')}`) })
  return { original, scope, server, sent, settled, printed, runner }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('runner: every run can be stopped', () => {
  it('stop ends a run whose request never settles: aborted, globals restored, later output dropped', async () => {
    const { original, scope, settled, printed, runner } = setup()
    let request!: Promise<Response>
    let lateLog!: (...a: unknown[]) => void
    const end = runner.run(async () => {
      scope.console.log('started')
      lateLog = scope.console.log
      request = scope.fetch(`${FAKE_ORIGIN}/users/slow`) // the fake server never answers 'slow'
      await request
    })
    request.catch(() => {})
    await tick()
    expect(runner.running).toBe(true)

    runner.stop()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(await end).toEqual({ ended: 'stopped' })
    expect(runner.running).toBe(false)
    expect(scope.fetch).toBe(original.fetch)
    expect(scope.console.log).toBe(original.log)
    expect(scope.console.error).toBe(original.error)
    expect(settled.map((s) => s.outcome)).toEqual(['cancelled'])
    lateLog('late')
    expect(printed).toEqual(['log: started'])
    expect(original.log).not.toHaveBeenCalled()
  })

  it("a stopped run's output never reaches the next run, and its liaise calls send nothing", async () => {
    const { scope, server, sent, printed, runner } = setup()
    vi.stubGlobal('fetch', server.fetch) // where liaise sends, whichever run is current
    const getUser = defineRequest<{ name: string }>()({ method: 'GET', path: '/users/:id' })
    let old!: RunHandle
    const first = runner.run(async (run) => { old = run; await new Promise(() => {}) })
    await tick()
    const api = createApi({ baseUrl: FAKE_ORIGIN, requests: { getUser }, middleware: [old.gate as never] })

    const second = runner.run(async () => { scope.console.log('second run') }) // starting a run stops the first
    expect(await first).toEqual({ ended: 'stopped' })
    old.console.log('ghost')
    const bridge = Reflect.get(globalThis, BRIDGE) as (id: number) => RunHandle
    bridge(old.id).console.log('ghost through the bridge')
    const late = await api.getUser({ id: '42' }) // the first run's loop, carrying on

    expect(late.error?.kind).toBe('abort')
    expect(sent).toEqual([])
    expect(await second).toEqual({ ended: 'done' })
    expect(printed).toEqual(['log: second run'])
  })

  it('a run that settles or throws restores the globals and aborts what it left in flight', async () => {
    const { original, scope, settled, runner } = setup()
    let leftover!: Promise<Response>
    expect(await runner.run(async () => { leftover = scope.fetch(`${FAKE_ORIGIN}/users/slow`) })).toEqual({ ended: 'done' })
    await expect(leftover).rejects.toMatchObject({ name: 'AbortError' })
    expect(settled.map((s) => s.outcome)).toEqual(['cancelled'])
    const boom = new Error('boom')
    expect(await runner.run(async () => { throw boom })).toEqual({ ended: 'threw', error: boom })
    expect(scope.fetch).toBe(original.fetch)
    expect(scope.console.log).toBe(original.log)
  })
})

describe("runner: the page's own requests", () => {
  it('go to the original fetch untouched, and outlive the run', async () => {
    const { original, scope, sent, runner } = setup((input) => String(input).startsWith('/'))
    vi.mocked(original.fetch).mockReturnValue(new Promise(() => {}))
    await runner.run(async () => { void scope.fetch('/liaise/liaise/dts.json') })
    expect(original.fetch).toHaveBeenCalledWith('/liaise/liaise/dts.json', undefined)
    expect(sent).toEqual([])
  })
})

describe('instrument and liaiseShim', () => {
  const lib = 'https://iremlopsum.github.io/liaise/liaise/'
  it("binds the module's console to its run on line 1 and points liaise at the run's shim", () => {
    const js = `import { createApi } from "liaise";\nimport { retryMiddleware } from 'liaise/middleware';\nconsole.log(1);\n`
    const out = instrument(js, 7, 'blob:shim', lib)
    expect(out.split('\n')).toHaveLength(js.split('\n').length)
    expect(out).toMatch(/^const console = globalThis\[Symbol\.for\('liaise\.playground\.run'\)\]\(7\)\.console;import/)
    expect(out).toContain(`from 'blob:shim'`)
    expect(out).toContain(`from '${lib}built-in-middleware.js'`)
  })
  it('re-exports liaise with gated clients', () => {
    const shim = liaiseShim(7, lib)
    expect(shim).toContain(`export * from "${lib}index.js"`)
    expect(shim).toContain(`(7).gate`)
    expect(shim).toMatch(/export const createApi = gated\(liaise\.createApi\)/)
    expect(shim).toMatch(/export const createGraphQL = gated\(liaise\.createGraphQL\)/)
  })
})

// The playground's own path: the example's JavaScript through instrument() and liaiseShim(), against
// the library build the site serves (public/liaise, copied there by the site build).
describe('an example run through the shim', () => {
  const LIB = fileURLToPath(new URL('../public/liaise/', import.meta.url))
  const TMP = new URL('./.tmp/runner/', import.meta.url) // this file's own: test files run in parallel
  const LATER = Symbol.for('liaise.playground.test.later')
  let n = 0 // file names never repeat: an imported module is cached by its path
  afterEach(() => { rmSync(TMP, { recursive: true, force: true }); Reflect.deleteProperty(globalThis, LATER) })

  // Starts a run of `js` (compiled example code) and resolves once it has printed `lines` lines.
  async function start(js: string, lines: number) {
    const ctx = setup()
    vi.stubGlobal('fetch', ctx.server.fetch) // where the library build sends
    mkdirSync(TMP, { recursive: true })
    const end = ctx.runner.run(async (run) => {
      const shim = fileURLToPath(new URL(`shim-${++n}.js`, TMP))
      const example = fileURLToPath(new URL(`example-${n}.js`, TMP))
      writeFileSync(shim, liaiseShim(run.id, LIB))
      writeFileSync(example, instrument(js, run.id, shim, LIB))
      await import(/* @vite-ignore */ example)
    })
    await vi.waitFor(() => expect(ctx.printed.length).toBeGreaterThanOrEqual(lines), { timeout: 5000 })
    return { ...ctx, end }
  }

  it('leaves a live call alone: middleware sees no signal when the call has none', async () => {
    const { printed, runner, end } = await start(`import { createApi, defineRequest } from 'liaise'
const seen = []
const watch = (where) => async (ctx, next) => { seen.push(where + ': ' + String(ctx.request.signal)); return next() }
const getUser = defineRequest()({ method: 'GET', path: '/users/:id', middleware: [watch('request')] })
const api = createApi({ baseUrl: 'https://api.example.com', requests: { getUser }, middleware: [watch('client')] })
const { data } = await api.getUser({ id: '42' }, { middleware: [watch('call')] })
console.log(data.name, seen)
`, 1)
    expect(await end).toEqual({ ended: 'done' })
    // Client, request and call middleware all run; the gate sits between client and request.
    expect(printed).toEqual(['log: Ada Lovelace client: undefined,request: undefined,call: undefined'])
    expect(runner.running).toBe(false)
  })

  it('after stop, a call through the gated client sends nothing', async () => {
    const { printed, sent, runner, end } = await start(`import { createApi, defineRequest } from 'liaise'
const api = createApi({ baseUrl: 'https://api.example.com', requests: { getUser: defineRequest()({ method: 'GET', path: '/users/:id' }) } })
const { data } = await api.getUser({ id: '42' })
console.log(data.name)
globalThis[Symbol.for('liaise.playground.test.later')] = () => api.getUser({ id: '7' })
await new Promise(() => {}) // never settles, like a 'slow' example
`, 1)
    runner.stop()
    expect(await end).toEqual({ ended: 'stopped' })
    const late = await (Reflect.get(globalThis, LATER) as () => Promise<{ error: { kind: string } | null }>)()
    expect(late.error?.kind).toBe('abort')
    expect(sent.map((r) => r.path)).toEqual(['/users/42'])
    expect(printed).toEqual(['log: Ada Lovelace'])
  })

  it('after stop, a retry that was waiting to go out never does', async () => {
    const { printed, sent, settled, runner, end } = await start(`import { createApi, defineRequest } from 'liaise'
import { retryMiddleware } from 'liaise/middleware'
const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUser: defineRequest()({ method: 'GET', path: '/users/:id' }) },
  middleware: [retryMiddleware({ max: 3, baseDelay: 300, jitter: false })],
})
console.log('started')
const { error } = await api.getUser({ id: 'flaky' })
globalThis[Symbol.for('liaise.playground.test.later')] = error?.kind ?? 'none'
console.log('ended with', error?.kind)
`, 1)
    // Stop only once the first 500 has been answered: the retry then waits 300 ms before it goes out.
    await vi.waitFor(() => expect(settled.map((s) => s.outcome)).toEqual([500]), { timeout: 5000 })
    expect(sent).toHaveLength(1)
    runner.stop()
    expect(await end).toEqual({ ended: 'stopped' })
    // Wait for the call to end rather than a fixed time: under load, a fixed wait can end before the retry would go.
    await vi.waitFor(() => expect(Reflect.get(globalThis, LATER)).toBeDefined(), { timeout: 5000 })
    expect(Reflect.get(globalThis, LATER)).toBe('abort')
    expect(sent.map((r) => r.path)).toEqual(['/users/flaky'])
    expect(printed).toEqual(['log: started'])
  })
})

describe('fake server: how an aborted request is labelled', () => {
  const getUser = defineRequest<{ name: string }>()({ method: 'GET', path: '/users/:id' })
  const serve = () => {
    const settled: unknown[] = []
    const server = createFakeServer({ onSettle: (s) => settled.push(s.outcome) })
    vi.stubGlobal('fetch', server.fetch)
    return settled
  }

  it("a request whose timeout passes is 'timeout', as liaise reports it", async () => {
    const settled = serve()
    const api = createApi({ baseUrl: FAKE_ORIGIN, requests: { getUser }, timeout: 20 })
    const { error } = await api.getUser({ id: 'slow' })
    expect(error?.kind).toBe('timeout')
    expect(settled).toEqual(['timeout'])
  })

  it("a request the caller cancels is 'cancelled'", async () => {
    const settled = serve()
    const api = createApi({ baseUrl: FAKE_ORIGIN, requests: { getUser } })
    const controller = new AbortController()
    const call = api.getUser({ id: 'slow' }, { signal: controller.signal })
    await tick()
    controller.abort()
    expect((await call).error?.kind).toBe('abort')
    expect(settled).toEqual(['cancelled'])
  })
})
