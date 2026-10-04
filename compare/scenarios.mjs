import { observe } from './observe.mjs'
import { startServer, deadUrl } from './server.mjs'

const user = { id: '1', name: 'Ada' }

/** @typedef {{ id: string, title: string, run: (variant) => Promise<{ outcome: string, ms: number }> }} Scenario */

const withServer = async (variant, fn) => {
  const server = await startServer()
  const auth = { access: 'expired', refresh: 'r1' }
  try { return await fn(variant.create({ baseUrl: server.baseUrl, auth }), server) }
  finally { await server.close() }
}
const offered = (client, method) => typeof client[method] === 'function'
const notOffered = { outcome: '—', ms: 0 }

export const scenarios = [
  { id: 'http-500', title: 'Server answers 500',
    run: v => withServer(v, c => observe(() => c.getJson('/s/500'), { expected: { ok: true } })) },
  { id: 'offline', title: 'Server unreachable',
    run: async v => { const c = v.create({ baseUrl: await deadUrl(), auth: { access: 'x', refresh: 'r1' } }); return observe(() => c.getJson('/s/ok'), { expected: { ok: true } }) } },
  { id: 'hang', title: 'Server never answers',
    run: v => withServer(v, c => observe(() => c.getJson('/s/hang'), { expected: { ok: true }, waitMs: 15_000 })) },
  { id: 'broken-json', title: '200 with broken JSON',
    run: v => withServer(v, c => observe(() => c.getJson('/s/broken-json'), { expected: { ok: true } })) },
  { id: 'empty-204', title: '204 with no body, on a JSON call',
    run: v => withServer(v, c => observe(() => c.getJson('/s/204'))) },
  { id: 'search-race', title: 'Search as you type: which results stay on screen',
    run: v => withServer(v, async c => {
      if (!offered(c, 'search')) return notOffered
      let shown = null
      const show = value => { const d = value && typeof value === 'object' && 'data' in value && 'error' in value ? value.data : value; if (d) shown = d }
      const started = performance.now()
      const calls = ['r', 're', 'rea'].map((q, i) => new Promise(r => setTimeout(r, i * 5)).then(() => c.search(q)).then(show, () => {}))
      await Promise.all(calls)
      return { outcome: shown ? `shows "${shown.q}"` : 'shows nothing', ms: Math.round(performance.now() - started) }
    }) },
  { id: 'refresh-stampede', title: 'Five requests get a 401 at once',
    run: v => withServer(v, async (c, server) => {
      if (!offered(c, 'getWithAuth')) return notOffered
      const started = performance.now()
      const settled = await Promise.allSettled(Array.from({ length: 5 }, () => c.getWithAuth('/s/orders')))
      const ok = settled.filter(s => s.status === 'fulfilled' && (s.value?.error == null) && (s.value?.data ?? s.value)?.ok === true).length
      const refreshes = server.counts.get('POST /s/refresh') ?? 0
      return { outcome: `${refreshes} refresh ${refreshes === 1 ? 'call' : 'calls'}, ${ok}/5 succeed`, ms: Math.round(performance.now() - started) }
    }) },
  { id: 'deadline', title: 'Slow 503s, 3 s deadline, 3 retries: when does the caller hear back',
    run: v => withServer(v, async (c, server) => {
      if (!offered(c, 'getWithDeadline')) return notOffered
      const r = await observe(() => c.getWithDeadline('/s/slow-503'), { expected: { ok: true }, waitMs: 15_000 })
      const attempts = server.counts.get('GET /s/slow-503') ?? 0
      return { outcome: `after ${(r.ms / 1000).toFixed(1)}s: ${r.outcome} (${attempts} ${attempts === 1 ? 'attempt' : 'attempts'})`, ms: r.ms }
    }) },
  { id: 'missing-param', title: 'Path param is undefined',
    run: v => withServer(v, async (c, server) => {
      const r = await observe(() => c.getUser(undefined))
      const sent = [...server.counts.keys()].some(k => k.startsWith('GET /s/users/'))
      if (!sent && /^(throws|error result)/.test(r.outcome)) return { ...r, outcome: `refused before sending (${r.outcome})` }
      return { ...r, outcome: r.outcome.replace(/^resolves with (.*)$/, (_, j) => { try { return `requests ${JSON.parse(j).requested}` } catch { return r.outcome } }) }
    }) },
  { id: 'wrong-shape', title: 'Response is missing a field the type promises',
    run: v => withServer(v, c => offered(c, 'getValidated') ? observe(() => c.getValidated('/s/user-wrong'), { expected: user }) : notOffered) },
]
