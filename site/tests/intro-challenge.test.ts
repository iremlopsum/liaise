import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { instrument, liaiseShim, type RunHandle, type RunScope } from '../src/playground/runner'
import { createFakeServer, FAKE_ORIGIN } from '../src/playground/fake-server'
import { createChallengeRunner, type Load } from '../src/intro/challenge/harness'
import { CHECKS, checkDown, checkHealthy, checkLiaise, checkThrows, checkTypes } from '../src/intro/challenge/checks'
import { SCAFFOLD, SOLUTION } from '../src/intro/challenge/files'
import { ENDPOINTS } from '../src/intro/challenge/endpoints'

const TMP = new URL('./.tmp/intro-challenge/', import.meta.url) // this file's own: test files run in parallel
// From TMP to the library's source. liaiseShim and instrument point the reader's file at it, the way
// the page points it at the site's build: real liaise, with the run's gate on every client.
const LIB = '../../../../src/'
let n = 0

/** Loads `source` for one run as the page does (instrument + liaiseShim), from files vitest compiles. */
const load = (source: string): Load => async (run: RunHandle) => {
  mkdirSync(TMP, { recursive: true })
  const k = n++
  writeFileSync(new URL(`shim-${k}.ts`, TMP), liaiseShim(run.id, LIB))
  writeFileSync(new URL(`unread-${k}.ts`, TMP), instrument(source, run.id, `./shim-${k}`, LIB))
  return import(/* @vite-ignore */ new URL(`unread-${k}.ts`, TMP).href)
}

/** What Check my code does: run against a healthy server, then a down one, and judge both. */
async function check(source: string, timeoutMs = 4000) {
  const runner = createChallengeRunner({ scope: globalThis as unknown as RunScope, print: () => {} })
  const a = await runner.run(load(source), { mode: 'healthy', timeoutMs })
  const b = await runner.run(load(source), { mode: 'down', timeoutMs })
  return { a, b, results: { liaise: checkLiaise(a), healthy: checkHealthy(a), down: checkDown(b, source), throws: checkThrows(a, b) } }
}

afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('the challenge', () => {
  it('lists its five checks in order', () => {
    expect(CHECKS.map((c) => c.id)).toEqual(['liaise', 'healthy', 'down', 'throws', 'types'])
  })

  it('passes the solution on every check', async () => {
    const { a, b, results } = await check(SOLUTION)
    expect(a.returned).toEqual({ value: '3 unread' })
    expect(b.returned).toEqual({ value: 'Notifications are unavailable (http)' })
    expect(a.viaLiaise).toEqual([{ method: 'GET', path: '/notifications/unread' }])
    expect(Object.values(results).map((r) => r.status)).toEqual(['pass', 'pass', 'pass', 'pass'])
    expect(checkTypes([])).toEqual({ status: 'pass' })
  })

  it('fails the scaffold, each check saying why', async () => {
    const { results } = await check(SCAFFOLD)
    expect(results.liaise).toEqual({ status: 'fail', reason: 'No request reached /notifications/unread. Define it with defineRequest, add it to createApi, and call it in unreadLabel().' })
    expect(results.healthy).toEqual({ status: 'fail', reason: "It returned ''. Expected '3 unread'." })
    expect(results.down).toEqual({ status: 'fail', reason: "It returned ''. Expected 'Notifications are unavailable (http)'." })
    expect(results.throws).toEqual({ status: 'pass' })
  })

  it('fails a plain-fetch answer on check 1, and on check 3 for typing the kind by hand', async () => {
    const plain = [
      'export async function unreadLabel(): Promise<string> {',
      "  const res = await fetch('https://api.example.com/notifications/unread')",
      "  if (!res.ok) return 'Notifications are unavailable (http)'",
      '  const { unread } = await res.json()',
      '  return `${unread} unread`',
      '}',
      '',
    ].join('\n')
    const { a, results } = await check(plain)
    expect(a.sent).toEqual([{ method: 'GET', path: '/notifications/unread' }])
    expect(a.viaLiaise).toEqual([])
    expect(results.liaise).toEqual({ status: 'fail', reason: '/notifications/unread was called with fetch directly. Call it through a client from createApi instead.' })
    expect(results.healthy.status).toBe('pass')
    expect(results.down.reason).toMatch(/typed by hand/)
  })

  it('fails "never throws" when the code reads data without checking error', async () => {
    const careless = SOLUTION.split('\n').filter((l) => !l.includes('if (error)')).join('\n')
    const { results } = await check(careless)
    expect(results.throws.status).toBe('fail')
    expect(results.throws.reason).toMatch(/^With the server down, unreadLabel\(\) threw TypeError: .*\. Check error before you read data\.$/)
  })

  it("reports a file that doesn't load, on every check", async () => {
    const { a, results } = await check('export const x = ;\n')
    expect(a.loadError).toBeDefined()
    expect(results.liaise.reason).toMatch(/^The file didn't load, so nothing was sent\./)
    expect(results.healthy.reason).toMatch(/^The file didn't load: /)
  })

  it('stops code that never settles at the time limit, and the next run works', async () => {
    const { a, results } = await check("export async function unreadLabel() { await new Promise(() => {}); return '' }\n", 200)
    expect(a.ended).toBe('timeout')
    expect(results.healthy.reason).toMatch(/didn't finish within 8 seconds/)
    expect((await check(SOLUTION)).results.healthy.status).toBe('pass')
  })

  it('names the count and the first type error', () => {
    expect(checkTypes([{ line: 3, message: "Cannot find name 'x'." }, { line: 9, message: 'Other.' }]))
      .toEqual({ status: 'fail', reason: "2 type errors. Line 3: Cannot find name 'x'." })
  })
})

describe('the API docs drawer', () => {
  it('documents what the fake API answers, example by example', async () => {
    const server = createFakeServer()
    for (const ep of ENDPOINTS) {
      const [method, path] = ep.example.request.split(' ')
      const res = await server.fetch(`${FAKE_ORIGIN}${path}`, { method })
      expect(res.status, ep.example.request).toBe(ep.example.status)
      expect(await res.json(), ep.example.request).toEqual(JSON.parse(ep.example.body))
    }
  })
  it('marks the challenge endpoint, and only it', () => {
    expect(ENDPOINTS.filter((e) => e.challenge).map((e) => e.path)).toEqual(['/notifications/unread'])
  })
})
