// Compiled by scripts/types-compat.mjs against the PACKED liaise (what npm ships) on every
// TypeScript version listed there, with skipLibCheck off, so liaise's own .d.ts files are
// checked too. It touches every public entry point and the type shapes consumers rely on.
// The @ts-expect-error lines are guards: an unused one is an error, so they prove the
// checker really sees liaise's types on that version. Not part of the test suite or the
// build; 'liaise' resolves only inside the temp project the script creates.
import {
  createApi, Request, defineRequest, paginate, poll, pollUntil, ApiError,
  createGraphQL, Operation, gql, withHeaders,
} from 'liaise'
import type {
  Result, CallOptions, Middleware, MiddlewareContext, ApiConfig, RequestConfig,
  FetchOptions, WithHeadersOptions, PollOptions, PaginateOptions, StandardSchemaV1,
} from 'liaise'
import { retryMiddleware, logMiddleware, cacheMiddleware } from 'liaise/middleware'
import { mockFetch, jsonResponse, successResult, errorResult } from 'liaise/testing'

type User = { id: string; name: string }
type Page = { items: User[]; next: string | null }

const auth: Middleware = async (ctx: MiddlewareContext, next) => {
  ctx.request.headers.set('authorization', 'Bearer x')
  return next()
}

const api = createApi({
  baseUrl: 'https://api.example.com',
  headers: { 'X-Client': 'web' },
  timeout: 5_000,
  fetchOptions: { credentials: 'include' },
  middleware: [auth, retryMiddleware(2), logMiddleware(), cacheMiddleware({ ttl: 1_000 })],
  requests: {
    getUser: defineRequest<User>()({ method: 'GET', path: '/users/:id' }),
    search: defineRequest<User[], { q: string }>()({ method: 'GET', path: '/users', dedupe: true }),
    list: defineRequest<Page, { cursor?: string }>()({ method: 'GET', path: '/users/page' }),
    health: new Request<Record<string, never>, { ok: boolean }>({ method: 'GET', path: '/health' }),
  },
})

async function main() {
  const r = await api.getUser({ id: '1' })
  if (r.error) {
    const e: ApiError = r.error
    console.log(e.kind, e.status)
  } else {
    const name: string = r.data.name
    console.log(name)
  }
  const options: CallOptions = { timeout: 1_000 }
  await api.search({ q: 'a' }, options)
  await api.health()
  const h: Record<string, string> = api.getUser.getHeaders()
  console.log(h)

  // withHeaders: same type as the original
  const who: WithHeadersOptions = { dedupe: false }
  const user: typeof api = withHeaders(api, { cookie: 's=1' }, who)
  const me = await user.getUser({ id: '2' })
  console.log(me.data?.name)

  // keyof the client is still just its endpoints (the 5.3.0 brand decision)
  type Results = { [K in keyof typeof api]: Awaited<ReturnType<(typeof api)[K]>> }
  const ok: Results['health']['data'] = null
  console.log(ok)

  for await (const page of paginate<{ cursor?: string }, Page>(api.list, {}, { next: p => (p.data.next ? { cursor: p.data.next } : null) })) {
    console.log(page.data?.items.length)
  }
  const pollEvery: PollOptions = { every: 5_000 }
  const stop = poll(api.health, {}, res => console.log(res.data?.ok), pollEvery)
  stop()
  const done = await pollUntil(api.health, {}, { every: 1_000, until: res => res.data.ok })
  console.log(done.error?.kind)

  const opUser = new Operation<{ id: string }, { user: User }>({ operation: gql`query U($id: ID!) { user(id: $id) { id name } }` })
  const flat = createGraphQL({ endpoint: 'https://api.example.com/graphql', operations: { opUser } })
  const g = await withHeaders(flat, { authorization: 'Bearer t' }).opUser({ id: '1' })
  console.log(g.data?.user.name)
  const split = createGraphQL({ endpoint: '/graphql', queries: { opUser }, mutations: { save: opUser } })
  await withHeaders(split, {}).query.opUser({ id: '1' })
  await withHeaders(split.query, {}).opUser({ id: '1' })

  const mock = mockFetch({ 'GET /users/:id': jsonResponse({ id: '1', name: 'Ada' }) })
  mock.install(); mock.restore()
  const s: Result<User> = successResult({ id: '1', name: 'Ada' })
  const f: Result<User> = errorResult(404)
  console.log(s, f)

  const cfg: RequestConfig = { method: 'GET', path: '/x' }
  const ac: Partial<ApiConfig<Record<string, never>>> = { baseUrl: '/' }
  const fo: FetchOptions = { keepalive: true }
  const po: PaginateOptions<{ cursor?: string }, Page> = { next: () => null }
  console.log(cfg, ac, fo, po)
  type Schema = StandardSchemaV1<User>
  const _schema: Schema | undefined = undefined
  console.log(_schema)
}
main()

// compile errors that must stay errors
// @ts-expect-error a single endpoint is not a client
withHeaders(api.getUser, {})
// @ts-expect-error a number is not a client
withHeaders(42, {})
