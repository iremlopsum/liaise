// A fake API that lives in the page, at FAKE_ORIGIN. While an example runs, the playground sends
// requests for that host here (route-fetch.ts), so every failure is repeatable.
//
//   GET  /users/:id   '42', '7', '3' → that person · other ids → Ada · '404' → 404 · '500' → 500
//                     'offline' → network failure · 'slow' → never answers
//                     'flaky' → 500, 500, then 200
//   GET  /search?q=   answers short queries more slowly, to show the race
//   POST /graphql     real GraphQL over the same people (fake-graphql.ts)
import { executeGraphQL, operationName } from './fake-graphql'

/** The fake API's host. Requests to any other origin are real (route-fetch.ts). */
export const FAKE_ORIGIN = 'https://api.example.com'

/** What the network panel shows once a request is over: a status, or how it failed. */
export type Outcome = number | 'offline' | 'cancelled'

/** `operation` is a GraphQL request's operation name, when it has one. */
export interface SentRequest { id: number; method: string; path: string; operation?: string }
export interface SettledRequest { id: number; outcome: Outcome; ms: number }

export interface FakeServerOptions {
  onRequest?: (request: SentRequest) => void
  onSettle?: (settled: SettledRequest) => void
}

export interface FakeServer {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  /** Forgets per-run state (the 'flaky' counter, renamed people), so every run starts the same. */
  reset(): void
}

export type Route =
  | { kind: 'hang' }
  | { kind: 'offline'; delay: number }
  | { kind: 'answer'; status: number; body: unknown; delay: number }

export interface Person { id: string; name: string; email: string; posts: Array<{ id: string; title: string }> }

const PEOPLE: readonly Person[] = [
  { id: '42', name: 'Ada Lovelace', email: 'ada@example.com', posts: [{ id: '1', title: 'Notes on the Analytical Engine' }] },
  { id: '7', name: 'Grace Hopper', email: 'grace@example.com', posts: [{ id: '2', title: 'The Education of a Computer' }] },
  { id: '3', name: 'Alan Turing', email: 'alan@example.com', posts: [{ id: '3', title: 'On Computable Numbers' }, { id: '4', title: 'Computing Machinery and Intelligence' }] },
]
const seed = (): Person[] => PEOPLE.map((p) => ({ ...p, posts: p.posts.map((post) => ({ ...post })) }))

const aborted = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export function createFakeServer({ onRequest = () => {}, onSettle = () => {} }: FakeServerOptions = {}): FakeServer {
  let flaky = 0
  const jobPolls = new Map<string, number>()
  let seq = 0
  let people = seed()

  function route(method: string, url: URL, body: string): Route | Promise<Route> {
    const job = /^\/jobs\/([^/]+)$/.exec(url.pathname)
    if (method === 'GET' && job) {
      const id = job[1]
      if (id !== '42') return { kind: 'answer', status: 404, body: { message: `No job ${id}` }, delay: 60 }
      const n = (jobPolls.get(id) ?? 0) + 1
      jobPolls.set(id, n)
      const status = n <= 2 ? 'queued' : n === 3 ? 'running' : 'done'
      return { kind: 'answer', status: 200, body: status === 'done' ? { id, status, result: 'report.csv' } : { id, status }, delay: 80 }
    }
    const user = /^\/users\/([^/]+)$/.exec(url.pathname)
    if (method === 'GET' && user) {
      const id = decodeURIComponent(user[1])
      if (id === 'offline') return { kind: 'offline', delay: 60 }
      if (id === 'slow') return { kind: 'hang' }
      if (id === '404') return { kind: 'answer', status: 404, body: { message: `No user ${id}` }, delay: 90 }
      if (id === '500') return { kind: 'answer', status: 500, body: { message: 'Internal error' }, delay: 110 }
      if (id === 'flaky') {
        // 250 ms per answer, so the retry hint holds on every run, not most runs: retryMiddleware
        // waits a random 0–250 ms, then 0–500 ms (full jitter). Three answers alone take 750 ms,
        // so a 600 ms deadline always wins; with waits, at most 1500 ms, so 3000 ms never does.
        // (At 120 ms, a 600 ms deadline let the call through about one run in five.)
        flaky += 1
        if (flaky <= 2) return { kind: 'answer', status: 500, body: { message: 'Try again' }, delay: 250 }
        return { kind: 'answer', status: 200, body: { id, name: 'Flaky Fred' }, delay: 250 }
      }
      const p = people.find((p) => p.id === id) ?? people[0]
      return { kind: 'answer', status: 200, body: { id, name: p.name, email: p.email }, delay: 140 }
    }
    if (method === 'GET' && url.pathname === '/search') {
      const q = url.searchParams.get('q') ?? ''
      // 120 ms for the full word, 220 ms more per missing letter. Keys come every 60 ms, so each
      // query is still in flight when the next key cancels it (dedupe on, 60 ms to spare), and
      // without dedupe the answers land in reverse: "l" last, 160 ms after "li".
      return { kind: 'answer', status: 200, body: [`${q}`, `${q} docs`, `${q} examples`], delay: 120 + 220 * Math.max(0, 6 - q.length) }
    }
    if (method === 'POST' && url.pathname === '/graphql') return executeGraphQL(body, people)
    return { kind: 'answer', status: 404, body: { message: 'Not found' }, delay: 50 }
  }

  async function fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined
    const url = new URL(request ? request.url : String(input))
    const method = (init.method ?? request?.method ?? 'GET').toUpperCase()
    const signal = init.signal ?? request?.signal ?? undefined
    // Like real fetch: an already-cancelled request is never sent.
    if (signal?.aborted) throw aborted(signal)
    const body = typeof init.body === 'string' ? init.body : request && init.body == null ? await request.clone().text() : ''
    if (signal?.aborted) throw aborted(signal)
    const id = ++seq
    const started = Date.now()
    const operation = url.pathname === '/graphql' ? operationName(body) : undefined
    onRequest({ id, method, path: url.pathname + url.search, ...(operation && { operation }) })

    return new Promise<Response>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const done = (outcome: Outcome, settle: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        onSettle({ id, outcome, ms: Date.now() - started })
        settle()
      }
      const onAbort = () => done('cancelled', () => reject(aborted(signal!)))
      if (signal?.aborted) return onAbort()
      signal?.addEventListener('abort', onAbort, { once: true })
      const answer = (r: Route) => {
        if (settled || r.kind === 'hang') return
        timer = setTimeout(() => {
          if (r.kind === 'offline') return done('offline', () => reject(new TypeError('Failed to fetch')))
          done(r.status, () => resolve(json(r.status, r.body)))
        }, r.delay)
      }
      // REST answers synchronously, so its timing is exact; /graphql executes first.
      const r = route(method, url, body)
      if (r instanceof Promise) r.then(answer, (e: unknown) => done(500, () => resolve(json(500, { message: String(e) }))))
      else answer(r)
    })
  }

  return { fetch, reset: () => { flaky = 0; people = seed(); jobPolls.clear() } }
}
