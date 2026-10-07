import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { createFakeServer } from '../src/playground/fake-server'

const EX = (id: string) => new URL(`../src/playground/examples/${id}.ts`, import.meta.url)
const TMP = new URL('./.tmp/playground/', import.meta.url) // this file's own: test files run in parallel
let n = 0

async function run(id: string, edits: Array<[string, string]> = []) {
  let src = readFileSync(EX(id), 'utf8')
  for (const [a, b] of edits) { expect(src).toContain(a); src = src.replace(a, b) }
  mkdirSync(TMP, { recursive: true })
  const file = new URL(`${id}-${n++}.ts`, TMP)
  writeFileSync(file, src)
  const net: Array<{ id: number; method: string; path: string; operation?: string; outcome?: string | number; sentAt: number; ms?: number }> = []
  const server = createFakeServer({ onRequest: r => net.push({ ...r, sentAt: Date.now() }), onSettle: s => Object.assign(net.find(r => r.id === s.id)!, s) })
  vi.stubGlobal('fetch', server.fetch)
  const log: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...a) => { log.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) })
  await import(/* @vite-ignore */ file.href)
  return { log, net }
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.unstubAllGlobals(); rmSync(TMP, { recursive: true, force: true }) })

describe('playground examples do what their hints say', () => {
  it('quick start: 42 → Hello, Ada Lovelace; 500, 404 and offline as the hint says', async () => {
    expect((await run('quick-start')).log).toEqual(['Hello, Ada Lovelace'])
    expect((await run('quick-start', [["id: '42'", "id: '500'"]])).log).toEqual(['http 500'])
    expect((await run('quick-start', [["id: '42'", "id: '404'"]])).log).toEqual(['http 404'])
    expect((await run('quick-start', [["id: '42'", "id: 'offline'"]])).log).toEqual(['network 0'])
  })
  it('every failure: five ids, five outcomes, none throws', async () => {
    expect((await run('errors')).log).toEqual(['42 → Ada Lovelace', '404 → http 404', '500 → http 500', 'offline → network 0', 'slow → timeout 0'])
  })
  it('search: dedupe on shows only the latest; off lets the stale answer land last', async () => {
    const on = await run('search')
    expect(on.log.at(-1)).toBe('"liaise" shows ["liaise","liaise docs","liaise examples"]')
    expect(on.log.filter(l => l.endsWith('cancelled'))).toHaveLength(5)
    const off = await run('search', [['dedupe: true', 'dedupe: false']])
    expect(off.log.at(-1)).toBe('"l" shows ["l","l docs","l examples"]')
    // By design, not by luck: the stale answer lands at least 150 ms after the one before it.
    const landed = off.net.map(r => ({ path: r.path, at: r.sentAt + r.ms! })).sort((a, b) => a.at - b.at)
    expect(landed.at(-1)!.path).toBe('/search?q=l')
    expect(landed.at(-1)!.at - landed.at(-2)!.at).toBeGreaterThanOrEqual(150)
  })
  it('share: one request for five callers; off: five', async () => {
    const on = await run('share')
    expect(on.net).toHaveLength(1)
    expect(on.log).toEqual(['5 of 5 callers got the user'])
    expect((await run('share', [['share: true', 'share: false']])).net).toHaveLength(5)
  })
  it('retry: 500, 500, 200; with a 600 ms timeout the deadline wins', async () => {
    const ok = await run('retry')
    expect(ok.net.map(r => r.outcome)).toEqual([500, 500, 200])
    expect(ok.log).toEqual(['got Flaky Fred on the third try'])
    expect((await run('retry', [['timeout: 3000', 'timeout: 600']])).log).toEqual(['gave up: timeout 0'])
  })
  it('graphql: query and mutation; 404 → GraphQL error with partialData; 500 and slow as over REST; the schema is checked', async () => {
    const ok = await run('graphql')
    expect(ok.net.map(r => `${r.method} ${r.path} (${r.operation}) ${r.outcome}`)).toEqual(['POST /graphql (GetUser) 200', 'POST /graphql (RenameUser) 200'])
    expect(ok.log).toEqual(['Ada Lovelace wrote ["Notes on the Analytical Engine"]', 'renamed to Ada King'])
    expect((await run('graphql', [["const id = '42'", "const id = '404'"]])).log).toEqual([
      'http 200',
      'body: [{"message":"User not found","locations":[{"line":1,"column":27}],"path":["user"]}]',
      'partial data: {"user":null}',
      'rename: http 200',
    ])
    expect((await run('graphql', [["const id = '42'", "const id = '500'"]])).log).toEqual(['http 500', 'body: {"message":"Internal error"}', 'rename: http 500'])
    expect((await run('graphql', [["const id = '42'", "const id = 'slow'"]])).log).toEqual(['timeout 0', 'rename: timeout 0'])
    expect((await run('graphql', [['posts { title }', 'posts { title likes }']])).log).toEqual([
      'http 200',
      'body: [{"message":"Cannot query field \\"likes\\" on type \\"Post\\".","locations":[{"line":1,"column":62}]}]',
      'renamed to Ada King',
    ])
  })
})
