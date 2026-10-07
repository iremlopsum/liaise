import { describe, it, expect, vi, afterEach } from 'vitest'
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
