// A fake API that lives in the page. The playground swaps it in for `fetch` while
// the example runs, so the real liaise build talks to it without a network.
//
//   GET  /users/:id   '42' and others → 200 · '404' → 404 · '500' → 500
//                     'offline' → network failure · 'slow' → never answers
//                     'flaky' → 500, 500, then 200
//   GET  /search?q=   answers short queries more slowly, to show the race

/** What the network panel shows once a request is over: a status, or how it failed. */
export type Outcome = number | 'offline' | 'cancelled'

export interface SentRequest { id: number; method: string; path: string }
export interface SettledRequest { id: number; outcome: Outcome; ms: number }

export interface FakeServerOptions {
  onRequest?: (request: SentRequest) => void
  onSettle?: (settled: SettledRequest) => void
}

export interface FakeServer {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  /** Forgets per-run state (the 'flaky' counter), so every run starts the same. */
  reset(): void
}

type Route =
  | { kind: 'hang' }
  | { kind: 'offline'; delay: number }
  | { kind: 'answer'; status: number; body: unknown; delay: number }

const NAMES: Record<string, string> = { 42: 'Ada Lovelace', 7: 'Grace Hopper', 3: 'Alan Turing' }

const aborted = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')

export function createFakeServer({ onRequest = () => {}, onSettle = () => {} }: FakeServerOptions = {}): FakeServer {
  let flaky = 0
  let seq = 0

  function route(method: string, url: URL): Route {
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
      return { kind: 'answer', status: 200, body: { id, name: NAMES[id] ?? 'Ada Lovelace', email: 'ada@example.com' }, delay: 140 }
    }
    if (method === 'GET' && url.pathname === '/search') {
      const q = url.searchParams.get('q') ?? ''
      return { kind: 'answer', status: 200, body: [`${q}`, `${q} docs`, `${q} examples`], delay: Math.max(70, 560 - q.length * 90) }
    }
    return { kind: 'answer', status: 404, body: { message: 'Not found' }, delay: 50 }
  }

  async function fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined
    const url = new URL(request ? request.url : String(input))
    const method = (init.method ?? request?.method ?? 'GET').toUpperCase()
    const signal = init.signal ?? request?.signal ?? undefined
    // Like real fetch: an already-cancelled request is never sent.
    if (signal?.aborted) throw aborted(signal)
    const id = ++seq
    const started = Date.now()
    onRequest({ id, method, path: url.pathname + url.search })
    const r = route(method, url)

    return new Promise<Response>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const done = (outcome: Outcome, settle: () => void) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        onSettle({ id, outcome, ms: Date.now() - started })
        settle()
      }
      const onAbort = () => done('cancelled', () => reject(aborted(signal!)))
      if (signal?.aborted) return onAbort()
      signal?.addEventListener('abort', onAbort, { once: true })
      if (r.kind === 'hang') return
      timer = setTimeout(() => {
        if (r.kind === 'offline') return done('offline', () => reject(new TypeError('Failed to fetch')))
        done(r.status, () =>
          resolve(new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })),
        )
      }, r.delay)
    })
  }

  return { fetch, reset: () => { flaky = 0 } }
}
