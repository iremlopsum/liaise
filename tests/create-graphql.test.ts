import { describe, it, expect, afterEach, vi } from 'vitest'
import { Operation, gql, createGraphQL } from '../src/graphql.js'
import type { Middleware } from '../src/types.js'
import { ABANDONED, wasJoined } from '../src/utils/share.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Operation', () => {
  it('stores the operation string', () => {
    const op = new Operation<{ id: string }, { name: string }>({
      operation: 'query GetUser($id: String!) { user(id: $id) { name } }',
    })
    expect(op.config.operation).toBe('query GetUser($id: String!) { user(id: $id) { name } }')
  })

  it('stores optional config fields', () => {
    const mw = vi.fn()
    const op = new Operation<Record<string, never>, { ok: boolean }>({
      operation: 'query { health }',
      dedupe: true,
      headers: { 'X-Custom': 'yes' },
      middleware: [mw],
    })
    expect(op.config.dedupe).toBe(true)
    expect(op.config.headers).toEqual({ 'X-Custom': 'yes' })
    expect(op.config.middleware).toEqual([mw])
  })
})

describe('gql', () => {
  it('returns the template string unchanged', () => {
    const query = gql`query GetUser($id: String!) { user(id: $id) { id name } }`
    expect(query).toBe('query GetUser($id: String!) { user(id: $id) { id name } }')
  })

  it('interpolates values', () => {
    const fields = 'id name'
    const query = gql`query { user { ${fields} } }`
    expect(query).toBe('query { user { id name } }')
  })

  it('preserves backslash escape sequences (String.raw behavior)', () => {
    const query = gql`query { user(filter: "\\w+") { id } }`
    expect(query).toBe('query { user(filter: "\\w+") { id } }')
  })
})

describe('createGraphQL — flat operations', () => {
  it('sends POST to the endpoint with { query, variables } body', async () => {
    const GET_USER = gql`query GetUser($id: String!) { user(id: $id) { id name } }`
    const getUser = new Operation<{ id: string }, { id: string; name: string }>({
      operation: GET_USER,
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ data: { id: '42', name: 'Alice' } })),
    })
    vi.stubGlobal('fetch', mockFetch)

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { getUser },
    })

    const { data, error } = await client.getUser({ id: '42' })

    expect(error).toBeNull()
    expect(data).toEqual({ id: '42', name: 'Alice' })
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/graphql',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ query: GET_USER, variables: { id: '42' } }),
      })
    )
  })

  it('sets Content-Type: application/json automatically', async () => {
    const op = new Operation<Record<string, never>, { ok: boolean }>({
      operation: gql`query { health }`,
    })
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ data: { ok: true } })),
    })
    vi.stubGlobal('fetch', mockFetch)

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { health: op },
    })

    await client.health()

    const headers: Headers = mockFetch.mock.calls[0][1].headers
    expect(headers.get('Content-Type')).toBe('application/json')
  })
})

describe('createGraphQL — split queries/mutations', () => {
  it('nests operations under client.query and client.mutation', async () => {
    const GET_USER = gql`query GetUser($id: String!) { user(id: $id) { id } }`
    const UPDATE_USER = gql`mutation UpdateUser($id: String!, $name: String!) { updateUser(id: $id, name: $name) { id } }`

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ data: { id: '1' } })),
    })
    vi.stubGlobal('fetch', mockFetch)

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      queries: {
        getUser: new Operation<{ id: string }, { id: string }>({ operation: GET_USER }),
      },
      mutations: {
        updateUser: new Operation<{ id: string; name: string }, { id: string }>({ operation: UPDATE_USER }),
      },
    })

    const { data: queryData } = await client.query.getUser({ id: '1' })
    const { data: mutationData } = await client.mutation.updateUser({ id: '1', name: 'Bob' })

    expect(queryData).toEqual({ id: '1' })
    expect(mutationData).toEqual({ id: '1' })
  })

  it('exposes only client.query when only queries are provided', async () => {
    const op = new Operation<{ id: string }, { id: string }>({
      operation: gql`query GetUser($id: String!) { user(id: $id) { id } }`,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK', headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ data: { id: '1' } })),
    }))

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      queries: { getUser: op },
    })

    expect(client).toHaveProperty('query.getUser')
    expect(client).not.toHaveProperty('mutation')
    const { data } = await client.query.getUser({ id: '1' })
    expect(data).toEqual({ id: '1' })
  })

  it('exposes only client.mutation when only mutations are provided', async () => {
    const op = new Operation<{ id: string }, { id: string }>({
      operation: gql`mutation DeleteUser($id: String!) { deleteUser(id: $id) { id } }`,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK', headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ data: { id: '1' } })),
    }))

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      mutations: { deleteUser: op },
    })

    expect(client).toHaveProperty('mutation.deleteUser')
    expect(client).not.toHaveProperty('query')
    const { data } = await client.mutation.deleteUser({ id: '1' })
    expect(data).toEqual({ id: '1' })
  })

  // A query and a mutation may share a name: they live in separate records, and
  // GraphQL allows it. Before 5.1.1 both records were merged by name, so the
  // mutation replaced the query and gql.query.user ran the mutation.
  describe('a query and a mutation with the same name', () => {
    const QUERY = gql`query User($id: String!) { user(id: $id) { id } }`
    const MUTATION = gql`mutation User($id: String!) { touchUser(id: $id) { id } }`
    const ok = () => ({
      ok: true, status: 200, statusText: 'OK', headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ data: { id: '1' } })),
    })

    it('each send their own document', async () => {
      const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(ok()))
      vi.stubGlobal('fetch', mockFetch)
      const client = createGraphQL({
        endpoint: 'https://api.example.com/graphql',
        queries: { user: new Operation<{ id: string }, { id: string }>({ operation: QUERY }) },
        mutations: { user: new Operation<{ id: string }, { id: string }>({ operation: MUTATION }) },
      })

      await client.query.user({ id: '1' })
      await client.mutation.user({ id: '1' })

      const sent = mockFetch.mock.calls.map((call) => JSON.parse(call[1].body).query)
      expect(sent).toEqual([QUERY, MUTATION])
    })

    it('each report their own headers', () => {
      const client = createGraphQL({
        endpoint: 'https://api.example.com/graphql',
        queries: { user: new Operation<{ id: string }, { id: string }>({ operation: QUERY, headers: { 'x-side': 'query' } }) },
        mutations: { user: new Operation<{ id: string }, { id: string }>({ operation: MUTATION, headers: { 'x-side': 'mutation' } }) },
      })

      expect(client.query.user.getHeaders()['x-side']).toBe('query')
      expect(client.mutation.user.getHeaders()['x-side']).toBe('mutation')
    })

    it('keep separate dedupe lanes: the query never cancels the mutation', async () => {
      const pending: Array<{ init: RequestInit; resolve: (r: unknown) => void }> = []
      vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
        pending.push({ init, resolve })
      })))
      const client = createGraphQL({
        endpoint: 'https://api.example.com/graphql',
        queries: { user: new Operation<{ id: string }, { id: string }>({ operation: QUERY, dedupe: true }) },
        mutations: { user: new Operation<{ id: string }, { id: string }>({ operation: MUTATION, dedupe: true }) },
      })

      const mutation = client.mutation.user({ id: '1' })
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      const query = client.query.user({ id: '1' })
      await vi.waitFor(() => expect(pending).toHaveLength(2))

      expect(pending[0].init.signal?.aborted).toBe(false)
      for (const p of pending) p.resolve(ok())
      const [m, q] = await Promise.all([mutation, query])
      expect(m.error).toBeNull()
      expect(q.error).toBeNull()
    })

    it('never join each other under share', async () => {
      const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(ok()))
      vi.stubGlobal('fetch', mockFetch)
      const client = createGraphQL({
        endpoint: 'https://api.example.com/graphql',
        queries: { user: new Operation<{ id: string }, { id: string }>({ operation: QUERY, share: true }) },
        mutations: { user: new Operation<{ id: string }, { id: string }>({ operation: MUTATION, share: true }) },
      })

      await Promise.all([client.query.user({ id: '1' }), client.mutation.user({ id: '1' })])

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('keep the plain name as requestName for middleware and the logger', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(ok())))
      const seen: string[] = []
      const record: Middleware = async (ctx, next) => { seen.push(ctx.requestName); return next() }
      const client = createGraphQL({
        endpoint: 'https://api.example.com/graphql',
        middleware: [record],
        queries: { user: new Operation<{ id: string }, { id: string }>({ operation: QUERY }) },
        mutations: { user: new Operation<{ id: string }, { id: string }>({ operation: MUTATION }) },
      })

      await client.query.user({ id: '1' })
      await client.mutation.user({ id: '1' })

      expect(seen).toEqual(['user', 'user'])
    })

    it('are each checked for share together with dedupe', () => {
      expect(() => createGraphQL({
        endpoint: 'https://api.example.com/graphql',
        queries: { user: new Operation<{ id: string }, { id: string }>({ operation: QUERY, share: true, dedupe: true }) },
        mutations: { user: new Operation<{ id: string }, { id: string }>({ operation: MUTATION }) },
      })).toThrow(/sets both share and dedupe/)
    })
  })
})

describe('createGraphQL — GraphQL errors (HTTP 200 with { errors })', () => {
  it('maps GraphQL errors to result.error, result.data is null', async () => {
    const getUser = new Operation<{ id: string }, { id: string }>({
      operation: gql`query GetUser($id: String!) { user(id: $id) { id } }`,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({
        data: null,
        errors: [{ message: 'User not found' }],
      })),
    }))

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { getUser },
    })

    const { data, error, response } = await client.getUser({ id: '99' })

    expect(data).toBeNull()
    expect(error).not.toBeNull()
    expect(error?.status).toBe(200)
    expect(error?.statusText).toBe('GraphQL Error')
    expect(error?.body).toEqual([{ message: 'User not found' }])
    expect(response).not.toBeNull()
    expect(response?.status).toBe(200)
  })
})

describe('createGraphQL — HTTP errors (4xx/5xx)', () => {
  it('maps a 404 response to result.error', async () => {
    const getUser = new Operation<{ id: string }, { id: string }>({
      operation: gql`query GetUser($id: String!) { user(id: $id) { id } }`,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ message: 'Not found' })),
    }))

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { getUser },
    })

    const { data, error, response } = await client.getUser({ id: '99' })

    expect(data).toBeNull()
    expect(error?.status).toBe(404)
    expect(error?.body).toEqual({ message: 'Not found' })
    expect(response?.status).toBe(404)
  })

  it('maps a 500 response to result.error with null body when response is empty', async () => {
    const op = new Operation<Record<string, never>, { ok: boolean }>({
      operation: gql`query { health }`,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers(),
      text: () => Promise.resolve(''),
    }))

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { health: op },
    })

    const { data, error } = await client.health()

    expect(data).toBeNull()
    expect(error?.status).toBe(500)
    expect(error?.body).toBeNull()
  })
})

describe('createGraphQL — network errors', () => {
  it('maps a network failure to result.error with status 0, response is null', async () => {
    const op = new Operation<Record<string, never>, { ok: boolean }>({
      operation: gql`query { health }`,
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { health: op },
    })

    const { data, error, response } = await client.health()

    expect(data).toBeNull()
    expect(error?.status).toBe(0)
    expect(error?.body).toBeInstanceOf(TypeError)
    expect(response).toBeNull()
  })
})

describe('createGraphQL — onError callback', () => {
  it('fires onError for GraphQL errors', async () => {
    const op = new Operation<{ id: string }, { id: string }>({
      operation: gql`query GetUser($id: String!) { user(id: $id) { id } }`,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK', headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ data: null, errors: [{ message: 'Oops' }] })),
    }))

    const onError = vi.fn()
    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { getUser: op },
      onError,
    })

    await client.getUser({ id: '1' })

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0].status).toBe(200)
  })

  it('fires onError for HTTP errors', async () => {
    const op = new Operation<{ id: string }, { id: string }>({
      operation: gql`query GetUser($id: String!) { user(id: $id) { id } }`,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, statusText: 'Unauthorized', headers: new Headers(),
      text: () => Promise.resolve(''),
    }))

    const onError = vi.fn()
    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { getUser: op },
      onError,
    })

    await client.getUser({ id: '1' })

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0].status).toBe(401)
  })

  it('fires onError for network errors', async () => {
    const op = new Operation<Record<string, never>, { ok: boolean }>({
      operation: gql`query { health }`,
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const onError = vi.fn()
    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { health: op },
      onError,
    })

    await client.health()

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0].status).toBe(0)
  })

  it('does NOT fire onError on success', async () => {
    const op = new Operation<Record<string, never>, { ok: boolean }>({
      operation: gql`query { health }`,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK', headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ data: { ok: true } })),
    }))

    const onError = vi.fn()
    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { health: op },
      onError,
    })

    const { error } = await client.health()

    expect(error).toBeNull()
    expect(onError).not.toHaveBeenCalled()
  })

  // Twin of tests/on-error.test.ts's "does not fire for a caller-initiated
  // abort", for the GraphQL path: src/graphql.ts has its own local
  // `fireOnError` and its own `buildFailedResult`/core() catch, so this is a
  // separate discriminating pin, not a duplicate of the REST suite. Finding 3
  // (round 2 review): nothing exercised this before, so the guard could be
  // deleted here with no red test.
  it('does not fire onError for a caller-initiated abort', async () => {
    const op = new Operation<Record<string, never>, unknown>({ operation: gql`query { health }` })
    vi.stubGlobal('fetch', hangingGqlFetch())
    const kinds: string[] = []
    const ac = new AbortController()
    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { health: op },
      onError: e => { kinds.push(e.kind) },
    })

    const p = client.health(undefined, { signal: ac.signal })
    ac.abort()

    const r = await p
    expect(r.error?.kind).toBe('abort')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(kinds).toEqual([])
  })
})

describe('createGraphQL — middleware', () => {
  it('runs global → per-operation → per-call middleware in order', async () => {
    const order: string[] = []
    const globalMw = vi.fn<Middleware>(async (_ctx, next) => { order.push('global'); return next() })
    const opMw = vi.fn<Middleware>(async (_ctx, next) => { order.push('operation'); return next() })
    const callMw = vi.fn<Middleware>(async (_ctx, next) => { order.push('call'); return next() })

    const op = new Operation<Record<string, never>, { ok: boolean }>({
      operation: gql`query { health }`,
      middleware: [opMw],
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK', headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ data: { ok: true } })),
    }))

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { health: op },
      middleware: [globalMw],
    })

    await client.health({}, { middleware: [callMw] })

    expect(order).toEqual(['global', 'operation', 'call'])
  })

  it('middleware can modify request headers', async () => {
    const op = new Operation<Record<string, never>, { ok: boolean }>({
      operation: gql`query { health }`,
    })
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK', headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ data: { ok: true } })),
    })
    vi.stubGlobal('fetch', mockFetch)

    const authMw = vi.fn<Middleware>(async (ctx, next) => {
      ctx.request.headers.set('Authorization', 'Bearer token123')
      return next()
    })

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { health: op },
      middleware: [authMw],
    })

    await client.health()

    const headers: Headers = mockFetch.mock.calls[0][1].headers
    expect(headers.get('Authorization')).toBe('Bearer token123')
  })

  it('skipMiddleware excludes middleware by reference', async () => {
    const mw = vi.fn<Middleware>(async (_ctx, next) => next())
    const op = new Operation<Record<string, never>, { ok: boolean }>({
      operation: gql`query { health }`,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK', headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ data: { ok: true } })),
    }))

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { health: op },
      middleware: [mw],
    })

    await client.health({}, { skipMiddleware: [mw] })

    expect(mw).not.toHaveBeenCalled()
  })
})

describe('createGraphQL — retry()', () => {
  it('retry() re-enters the full execution pipeline', async () => {
    const op = new Operation<{ id: string }, { id: string }>({
      operation: gql`query GetUser($id: String!) { user(id: $id) { id } }`,
    })
    let callCount = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve({
          ok: false, status: 503, statusText: 'Service Unavailable', headers: new Headers(),
          text: () => Promise.resolve(''),
        })
      }
      return Promise.resolve({
        ok: true, status: 200, statusText: 'OK', headers: new Headers(),
        text: () => Promise.resolve(JSON.stringify({ data: { id: '1' } })),
      })
    }))

    const mw = vi.fn<Middleware>(async (_ctx, next) => next())

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { getUser: op },
      middleware: [mw],
    })

    const firstResult = await client.getUser({ id: '1' })
    expect(firstResult.error?.status).toBe(503)

    const retryResult = await firstResult.retry()
    expect(retryResult.data).toEqual({ id: '1' })
    expect(retryResult.error).toBeNull()
    expect(callCount).toBe(2)
    expect(mw).toHaveBeenCalledTimes(2)
  })
})

describe('createGraphQL — dedupe', () => {
  it('aborts the previous in-flight request when the same operation is called again', async () => {
    const op = new Operation<{ id: string }, { id: string }>({
      operation: gql`query GetUser($id: String!) { user(id: $id) { id } }`,
      dedupe: true,
    })

    let firstCallSignal: AbortSignal | undefined
    let callCount = 0

    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      callCount++
      if (callCount === 1) {
        firstCallSignal = init.signal as AbortSignal
        return new Promise(() => {}) // hangs forever
      }
      return Promise.resolve({
        ok: true, status: 200, statusText: 'OK', headers: new Headers(),
        text: () => Promise.resolve(JSON.stringify({ data: { id: '2' } })),
      })
    }))

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { getUser: op },
    })

    // First call hangs — don't await
    client.getUser({ id: '1' })

    // Second call should abort the first
    await client.getUser({ id: '2' })

    expect(firstCallSignal?.aborted).toBe(true)
    expect(callCount).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// timeout — the GraphQL path shares `timeoutSignalFor` with createApi, so it
// inherits every defect in it. Nothing here was covered by an executable test
// before: a defect living in the shared helper is exactly what a file-by-file
// comparison against the REST implementation cannot find.
// ---------------------------------------------------------------------------

/** A fetch that never resolves unless its signal aborts. */
function hangingGqlFetch() {
  return vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
    const s = init.signal as AbortSignal | undefined
    if (!s) { rej(new Error('no signal reached fetch')); return }
    if (s.aborted) { rej(s.reason); return }
    s.addEventListener('abort', () => rej(s.reason))
  }))
}

describe('createGraphQL — timeout', () => {
  it('aborts the operation and reports kind "timeout"', async () => {
    vi.stubGlobal('fetch', hangingGqlFetch())
    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: {
        slow: new Operation<Record<string, never>, unknown>({ operation: 'query { slow }', timeout: 20 }),
      },
    })

    const { error } = await client.slow()

    expect(error).not.toBeNull()
    expect(error!.kind).toBe('timeout')
    expect(error!.status).toBe(0)
  })

  it('lets a per-call timeout override the per-operation one', async () => {
    vi.stubGlobal('fetch', hangingGqlFetch())
    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: {
        slow: new Operation<Record<string, never>, unknown>({ operation: 'query { slow }', timeout: 10_000 }),
      },
    })

    const started = Date.now()
    const { error } = await client.slow({}, { timeout: 20 })

    expect(error!.kind).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('accepts a fractional timeout instead of never sending the operation', async () => {
    // AbortSignal.timeout() throws a RangeError on a non-integer. Before the
    // fix that throw happened during setup, so the operation was never sent at
    // all and the caller got kind: 'network' with a RangeError body —
    // indistinguishable from being offline.
    const f = hangingGqlFetch()
    vi.stubGlobal('fetch', f)
    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: {
        slow: new Operation<Record<string, never>, unknown>({ operation: 'query { slow }', timeout: 20.5 }),
      },
    })

    const { error } = await client.slow()

    expect(f).toHaveBeenCalled()                      // the operation was actually issued
    expect(error!.body).not.toBeInstanceOf(RangeError)
    expect(error!.kind).toBe('timeout')
  })
})

describe('createGraphQL — error kind', () => {
  it('reports kind "http" for a GraphQL-errors response (HTTP 200)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ errors: [{ message: 'Field not found' }] })),
    }))

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { broken: new Operation<Record<string, never>, unknown>({ operation: 'query { broken }' }) },
    })

    const { error } = await client.broken()

    // A GraphQL error is a server answer, not a transport failure: it must
    // classify as 'http' so consumers branching on kind do not mistake it for
    // a network problem worth retrying.
    expect(error!.kind).toBe('http')
    expect(error!.status).toBe(200)
  })
})

describe('createGraphQL — malformed body on a successful response', () => {
  it('reports kind "parse" with the real status and a non-null response', async () => {
    const fakeResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: () => Promise.resolve('<html>oops</html>'),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse))

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { broken: new Operation<Record<string, never>, unknown>({ operation: 'query { broken }' }) },
    })

    const { data, error, response } = await client.broken()

    // Mirrors the REST parse-errors.test.ts assertions: the server answered
    // (2xx), but the body was not JSON. This must report as what it is --
    // kind 'parse' with the real status and Response -- not fall through to
    // the network catch (status 0, response null).
    expect(data).toBeNull()
    expect(error?.kind).toBe('parse')
    expect(error?.status).toBe(200)
    expect(response).not.toBeNull()
    expect(response?.status).toBe(200)
  })
})

// Round 4 review, Finding 2: graphql.ts's !response.ok branch has the
// identical bug REST had — response.text() is the network body read, not
// just parsing, and its catch swallowed everything into body: null with no
// provenance check. An abort landing while an ERROR body downloads used to
// misreport as a genuine 'http' error instead of the caller's own
// cancellation.
describe('createGraphQL — abort during an error-body download', () => {
  afterEach(() => vi.restoreAllMocks())

  it('does not report a real abort mid error-body-download as an http error', async () => {
    const onError = vi.fn()
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      const s = init.signal as AbortSignal | undefined
      return Promise.resolve({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers(),
        text: () => new Promise<string>((_resolve, reject) => {
          if (s?.aborted) { reject(s.reason); return }
          s?.addEventListener('abort', () => reject(s.reason))
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { broken: new Operation<Record<string, never>, unknown>({ operation: 'query { broken }' }) },
      onError,
    })

    const ac = new AbortController()
    const p = client.broken(undefined, { signal: ac.signal })
    ac.abort()

    const { data, error, response } = await p
    expect(data).toBeNull()
    expect(error?.kind).toBe('abort')
    expect(response).toBeNull()

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(onError).not.toHaveBeenCalled()
  })

  // Control: a genuine 503 with no abort must still classify 'http' with
  // the real status and a non-null response, and still report.
  it('still reports a genuine error status with no abort as http', async () => {
    const onError = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers(),
      text: () => Promise.resolve(''),
    }))

    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { broken: new Operation<Record<string, never>, unknown>({ operation: 'query { broken }' }) },
      onError,
    })

    const { data, error, response } = await client.broken()
    expect(data).toBeNull()
    expect(error?.kind).toBe('http')
    expect(error?.status).toBe(503)
    expect(response).not.toBeNull()
    expect(response?.status).toBe(503)

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(onError).toHaveBeenCalledTimes(1)
  })
})

// M1 (whole-branch review, final fix wave): an abort while the 2xx success
// body downloads must stay `kind: 'abort'`. The body is read once, in
// `sendExchange` (src/utils/exchange.ts), which throws a read its own signal
// aborted as an `AbortedRead`; graphql.ts classifies that in its outer catch,
// by the signal's reason, never inside the JSON.parse try — the same
// provenance rule as the error-body path above. create-api.ts's success-path
// decode (the comment beginning "Decode in its own try") has the fuller
// writeup. Without a test pinning this, a change that let that read failure
// reach the parse path would silently flip an abort mid-download from
// `kind: 'abort'` (status 0, no Response, unreported) to `kind: 'parse'`
// (status 200, live Response, reported) with a fully green suite.
describe('createGraphQL — abort during a success-body download', () => {
  afterEach(() => vi.restoreAllMocks())

  it('does not report a real abort mid success-body-download as a parse failure', async () => {
    const onError = vi.fn()
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      const s = init.signal as AbortSignal | undefined
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: () => new Promise<string>((_resolve, reject) => {
          if (s?.aborted) { reject(s.reason); return }
          s?.addEventListener('abort', () => reject(s.reason))
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const op = new Operation<Record<string, never>, unknown>({ operation: gql`query { health }` })
    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: { health: op },
      onError,
    })

    const ac = new AbortController()
    const p = client.health(undefined, { signal: ac.signal })
    ac.abort()

    const { data, error, response } = await p
    expect(data).toBeNull()
    expect(error?.kind).toBe('abort')
    expect(error?.status).toBe(0)
    expect(response).toBeNull()

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('GraphQL partial data', () => {
  afterEach(() => vi.restoreAllMocks())

  it('preserves partial data alongside the errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { user: { name: 'Ada' }, posts: null },
      errors: [{ message: 'posts unavailable' }],
    }), { status: 200 })))
    const client = createGraphQL({
      endpoint: '/gql',
      operations: { getUser: new Operation<Record<string, never>, { user: { name: string } }>({ operation: 'query { user { name } }' }) },
    })
    const r = await client.getUser()
    expect(r.error).not.toBeNull()
    expect(r.data).toBeNull()
    expect(r.error!.partialData).toEqual({ user: { name: 'Ada' }, posts: null })
  })

  // The fixture must send `data: null` explicitly, not omit `data` entirely —
  // what a spec-compliant GraphQL server sends when execution began and then
  // failed outright, and the common real-world shape of "no useful data".
  // Omitting `data` makes `gqlBody.data` already `undefined` before the `??
  // undefined` in graphql.ts ever runs, so the assertion below would pass
  // even with that operator deleted — it wouldn't discriminate the fix at
  // all. With `data: null` explicit, removing `?? undefined` would leave
  // `partialData: null`, which fails `.toBeUndefined()`.
  it('leaves partialData undefined when no data came back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: null,
      errors: [{ message: 'totally broken' }],
    }), { status: 200 })))
    const client = createGraphQL({
      endpoint: '/gql',
      operations: { getUser: new Operation<Record<string, never>, unknown>({ operation: 'query { user { name } }' }) },
    })
    expect((await client.getUser()).error!.partialData).toBeUndefined()
  })
})

// -----------------------------------------------------------------------------
// 4.0.0: a GraphQL success must carry data.
//
// The success path used to end at `createSuccessResult(gqlBody?.data ?? null)`,
// which produced data: null from two different inputs — an empty body, and a
// well-formed {} or {"data": null} with no errors. Both are protocol
// violations: GraphQL over HTTP requires a map at the root, and a "data": null
// that is legitimate (a field error) carries `errors`, which the branch above
// this one already routes to an error Result with partialData. Reaching the
// success return with no data means the server sent something invalid.
// -----------------------------------------------------------------------------
describe('createGraphQL — a success must carry data', () => {
  afterEach(() => { vi.restoreAllMocks() })

  const clientFor = (text: string, onError?: (e: unknown) => void) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: () => Promise.resolve(text),
    }))
    return createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: {
        health: new Operation<Record<string, never>, { ok: boolean }>({
          operation: gql`query { health }`,
        }),
      },
      ...(onError ? { onError } : {}),
    })
  }

  it("reports an empty body as a 'parse' error", async () => {
    const { data, error, response } = await clientFor('').health()
    expect(error?.kind).toBe('parse')
    expect(data).toBeNull()
    expect(response).not.toBeNull()
  })

  it("reports {} — no data, no errors — as a 'parse' error", async () => {
    const { error } = await clientFor('{}').health()
    expect(error?.kind).toBe('parse')
  })

  it("reports a literal \"data\": null with no errors as a 'parse' error", async () => {
    const { error } = await clientFor('{"data":null}').health()
    expect(error?.kind).toBe('parse')
  })

  it('reports a non-object JSON root as a parse error', async () => {
    // Valid JSON, invalid GraphQL — the spec requires a map at the root.
    const { error } = await clientFor('42').health()
    expect(error?.kind).toBe('parse')
  })

  it('keeps the real status and the Response', async () => {
    const { error, response } = await clientFor('{}').health()
    expect(error?.status).toBe(200)
    expect(error?.statusText).toBe('OK')
    expect(response?.status).toBe(200)
  })

  it('carries the raw response text as error.body', async () => {
    const { error } = await clientFor('{}').health()
    expect(error?.body).toBe('{}')
  })

  it('reports through onError like any other final error', async () => {
    const onError = vi.fn()
    await clientFor('{}', onError).health()
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0].kind).toBe('parse')
  })

  it('still succeeds when data is present', async () => {
    const { data, error } = await clientFor('{"data":{"ok":true}}').health()
    expect(error).toBeNull()
    expect(data).toEqual({ ok: true })
  })

  it('treats an empty data object as present — it is a valid result', async () => {
    // The guard is `== null`, not truthiness. A selection set that resolves
    // to {} is a legitimate GraphQL success and must not be rejected.
    const { data, error } = await clientFor('{"data":{}}').health()
    expect(error).toBeNull()
    expect(data).toEqual({})
  })

  it('still routes "data": null WITH errors to the GraphQL-error branch', async () => {
    // Regression pin: the errors branch runs BEFORE the no-data guard, so a
    // genuine field error keeps its 'http' classification and its
    // partialData. Reordering the two would silently reclassify every
    // GraphQL error in the library.
    const { error } = await clientFor('{"data":null,"errors":[{"message":"Oops"}]}').health()
    expect(error?.kind).toBe('http')
    expect(error?.body).toEqual([{ message: 'Oops' }])
  })
})

// -----------------------------------------------------------------------------
// 4.0.1: the errors branch hardcoded `status: 200`, so a GraphQL error arriving
// on any other 2xx reported a status the server never sent. Every other
// ApiError in both clients carries the response's own status.
//
// `statusText: 'GraphQL Error'` is deliberately NOT the response's own: it is
// the only signal separating a GraphQL error from an HTTP error, because
// `kind` is 'http' for both. Pinned below so it is not "tidied" away.
// -----------------------------------------------------------------------------
describe('createGraphQL — a GraphQL error reports the real status', () => {
  afterEach(() => { vi.restoreAllMocks() })

  const clientFor = (text: string, status: number, statusText = 'OK') => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText,
      headers: new Headers(),
      text: () => Promise.resolve(text),
    }))
    return createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: {
        health: new Operation<Record<string, never>, { ok: boolean }>({
          operation: gql`query { health }`,
        }),
      },
    })
  }

  const ERRORS = '{"data":null,"errors":[{"message":"Oops"}]}'

  it('reports 203 when the response was a 203', async () => {
    const { error } = await clientFor(ERRORS, 203, 'Non-Authoritative Information').health()
    expect(error?.status).toBe(203)
  })

  it('still reports 200 when the response really was a 200', async () => {
    const { error } = await clientFor(ERRORS, 200).health()
    expect(error?.status).toBe(200)
  })

  it("keeps statusText 'GraphQL Error' as the discriminator", async () => {
    // Not the response's statusText. This is the only thing telling a
    // consumer the failure came from `{ errors }` rather than from HTTP.
    const { error } = await clientFor(ERRORS, 203, 'Non-Authoritative Information').health()
    expect(error?.statusText).toBe('GraphQL Error')
  })

  it("still classifies as kind 'http' with the errors as the body", async () => {
    const { error } = await clientFor(ERRORS, 203).health()
    expect(error?.kind).toBe('http')
    expect(error?.body).toEqual([{ message: 'Oops' }])
  })

  it('still carries partialData when the server sent some', async () => {
    const { error } = await clientFor('{"data":{"ok":true},"errors":[{"message":"partial"}]}', 200).health()
    expect(error?.partialData).toEqual({ ok: true })
  })
})

// -----------------------------------------------------------------------------
// 4.0.1: coverage for a shape 4.0.0 handles correctly but never pinned. An
// empty `errors` array is falsy on `.length`, so it falls past the errors
// branch into the no-data guard and reports 'parse'. That is right -- the
// server sent neither data nor any actual error -- but nothing asserted it.
// -----------------------------------------------------------------------------
describe('createGraphQL — an empty errors array', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it("reports 'parse', not 'http', because there is no error to report", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK', headers: new Headers(),
      text: () => Promise.resolve('{"errors":[]}'),
    }))
    const client = createGraphQL({
      endpoint: 'https://api.example.com/graphql',
      operations: {
        health: new Operation<Record<string, never>, { ok: boolean }>({
          operation: gql`query { health }`,
        }),
      },
    })
    const { data, error } = await client.health()
    expect(error?.kind).toBe('parse')
    expect(error?.body).toBe('{"errors":[]}')
    expect(data).toBeNull()
  })
})

describe('createGraphQL — client-level timeout (5.1.0)', () => {
  const ep = 'https://api.example.com/graphql'
  const slowOp = (extra: { timeout?: number } = {}) =>
    new Operation<Record<string, never>, unknown>({ operation: gql`query { x }`, ...extra })

  it('applies the client timeout when neither the operation nor the call sets one', async () => {
    vi.stubGlobal('fetch', hangingGqlFetch())
    const client = createGraphQL({ endpoint: ep, timeout: 20, operations: { slow: slowOp() } })
    expect((await client.slow()).error?.kind).toBe('timeout')
  })

  it('lets the operation timeout beat the client timeout', async () => {
    vi.stubGlobal('fetch', hangingGqlFetch())
    const client = createGraphQL({ endpoint: ep, timeout: 5_000, operations: { slow: slowOp({ timeout: 20 }) } })
    const started = Date.now()
    expect((await client.slow()).error?.kind).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('lets an operation timeout of 0 opt out of the client timeout', async () => {
    vi.stubGlobal('fetch', hangingGqlFetch())
    const client = createGraphQL({ endpoint: ep, timeout: 20, operations: { slow: slowOp({ timeout: 0 }) } })
    const ac = new AbortController()
    const pending = client.slow({}, { signal: ac.signal })
    await new Promise(r => setTimeout(r, 60))
    ac.abort()
    expect((await pending).error?.kind).toBe('abort')
  })

  it('lets a per-call timeout beat both', async () => {
    vi.stubGlobal('fetch', hangingGqlFetch())
    const client = createGraphQL({ endpoint: ep, timeout: 5_000, operations: { slow: slowOp({ timeout: 5_000 }) } })
    expect((await client.slow({}, { timeout: 20 })).error?.kind).toBe('timeout')
  })
})

// ---------------------------------------------------------------------------
// share (5.1.0). The REST client's design (tests/share.test.ts), in GraphQL's
// own pipeline: every caller runs its own pipeline, and core joins an
// identical operation already in flight instead of sending its own —
// identical meaning what is about to be sent: the operation name, the
// endpoint, the final headers (minus the tracing list) and the body, query
// and variables exactly as serialised. Only the round trip is shared; each
// caller parses its own copy of the one response.
// ---------------------------------------------------------------------------
describe('share (5.1.0)', () => {
  afterEach(() => vi.restoreAllMocks())
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const slow = (body: unknown, status = 200) => vi.fn(() => new Promise<Response>(r => setTimeout(() => r(reply(body, status)), 10)))
  const opX = () => new Operation<{ id?: string }, { x: number | null }>({ operation: gql`query X($id: String) { x(id: $id) }`, share: true })
  const endpoint = 'https://x.test/graphql'

  it('shares identical concurrent operations: one fetch, own Results, own data', async () => {
    const fetchMock = slow({ data: { x: 1 } }); vi.stubGlobal('fetch', fetchMock)
    const g = createGraphQL({ endpoint, operations: { getX: opX() } })
    const [a, b] = await Promise.all([g.getX({ id: '1' }), g.getX({ id: '1' })])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a).not.toBe(b)
    expect(a.data).not.toBe(b.data)
    expect(a.data).toEqual(b.data)
  })

  it('does not share when variables differ', async () => {
    const fetchMock = slow({ data: { x: 1 } }); vi.stubGlobal('fetch', fetchMock)
    const g = createGraphQL({ endpoint, operations: { getX: opX() } })
    await Promise.all([g.getX({ id: '1' }), g.getX({ id: '2' })])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not share across users: headers a global middleware adds are part of the key', async () => {
    let user = 'alice'
    const auth: Middleware = (ctx, next) => { ctx.request.headers.set('authorization', `Bearer ${user}`); return next() }
    const fetchMock = slow({ data: { x: 1 } }); vi.stubGlobal('fetch', fetchMock)
    const g = createGraphQL({ endpoint, middleware: [auth], operations: { getX: opX() } })
    const a = g.getX({ id: '1' })
    user = 'bob'
    const b = g.getX({ id: '1' })
    await Promise.all([a, b])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws at createGraphQL when an operation sets both share and dedupe', () => {
    expect(() => createGraphQL({ endpoint, operations: {
      x: new Operation({ operation: gql`query { x }`, share: true, dedupe: true }),
    } })).toThrow(/share and dedupe/)
  })

  it('gives each caller its own partialData on a GraphQL errors response', async () => {
    const fetchMock = slow({ data: { x: null }, errors: [{ message: 'boom' }] }); vi.stubGlobal('fetch', fetchMock)
    const g = createGraphQL({ endpoint, operations: { getX: opX() } })
    const [a, b] = await Promise.all([g.getX({ id: '1' }), g.getX({ id: '1' })])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a.error?.kind).toBe('http')
    expect(a.error?.partialData).toEqual({ x: null })
    expect(a.error?.partialData).not.toBe(b.error?.partialData)
  })

  it('reports one failed shared operation to onError once', async () => {
    const fetchMock = slow({ errors: [{ message: 'down' }] }, 500); vi.stubGlobal('fetch', fetchMock)
    const onError = vi.fn()
    const g = createGraphQL({ endpoint, onError, operations: { getX: opX() } })
    await Promise.all([g.getX({ id: '1' }), g.getX({ id: '1' }), g.getX({ id: '1' })])
    await new Promise(r => setTimeout(r, 0))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('works for the queries/mutations split client', async () => {
    const fetchMock = slow({ data: { x: 1 } }); vi.stubGlobal('fetch', fetchMock)
    const g = createGraphQL({ endpoint, queries: { getX: opX() } })
    await Promise.all([g.query.getX({ id: '1' }), g.query.getX({ id: '1' })])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a shared 200 with GraphQL errors to onError once', async () => {
    const fetchMock = slow({ data: null, errors: [{ message: 'boom' }] }); vi.stubGlobal('fetch', fetchMock)
    const kinds: string[] = []
    const g = createGraphQL({ endpoint, onError: e => { kinds.push(e.kind) }, operations: { getX: opX() } })
    const rs = await Promise.all([g.getX({ id: '1' }), g.getX({ id: '1' }), g.getX({ id: '1' })])
    await new Promise(r => setTimeout(r, 0))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(rs.map(r => r.error?.kind)).toEqual(['http', 'http', 'http'])
    expect(kinds).toEqual(['http'])
  })

  // REST: "own give-up landing after a shared failure has answered: the
  // failure still reports once". The validator runs once per caller, after the
  // round trip has answered, and aborts the first caller's own signal (with a
  // TimeoutError, which onError does not drop) before refusing the value.
  it('decodes a shared schema refusal per caller and reports it once', async () => {
    const fetchMock = slow({ data: { x: 1 } }); vi.stubGlobal('fetch', fetchMock)
    const ac = new AbortController()
    const validate = vi.fn(() => {
      if (!ac.signal.aborted) ac.abort(new DOMException('gave up', 'TimeoutError'))
      return { issues: [{ message: 'refused' }] }
    })
    const schema = { '~standard': { version: 1 as const, vendor: 'test', validate } }
    const kinds: string[] = []
    const g = createGraphQL({
      endpoint,
      onError: e => { kinds.push(e.kind) },
      operations: { getX: new Operation<{ id?: string }, { x: number }>({ operation: gql`query X($id: String) { x(id: $id) }`, share: true, schema }) },
    })
    const [a, b] = await Promise.all([g.getX({ id: '1' }, { signal: ac.signal }), g.getX({ id: '1' })])
    await new Promise(r => setTimeout(r, 0))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(validate).toHaveBeenCalledTimes(2)
    expect(ac.signal.aborted).toBe(true)
    expect(a.error?.kind).toBe('parse')
    expect(b.error?.kind).toBe('parse')
    expect(kinds).toEqual(['parse'])
  })

  it('throws at createGraphQL when a split-client query sets both share and dedupe', () => {
    expect(() => createGraphQL({ endpoint, queries: {
      x: new Operation({ operation: gql`query { x }`, share: true, dedupe: true }),
    } })).toThrow(/share and dedupe/)
  })
})

// ---------------------------------------------------------------------------
// The REST guarantees, on GraphQL's pipeline. Each test names the REST row in
// tests/share.test.ts it mirrors where there is one.
// ---------------------------------------------------------------------------

/** Drains every pending microtask, then one macrotask. */
const flushShare = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/** A fetch whose every call waits for the test to answer it, and rejects with its signal's reason. */
function controllableGql() {
  const calls: {
    respond: (status: number, body: unknown) => void
    reject: (err: unknown) => void
    aborted: () => boolean
    reason: () => unknown
  }[] = []
  const fn = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((res, rej) => {
    const s = init.signal as AbortSignal | undefined
    s?.addEventListener('abort', () => rej(s.reason))
    calls.push({
      respond: (status, body) => res(new Response(JSON.stringify(body), { status })),
      reject: rej,
      aborted: () => !!s?.aborted,
      reason: () => s?.reason,
    })
  }))
  return { fn, calls }
}

/** The call's Result, or 'hung' if it has not settled within `ms` — a hang fails as an assertion. */
async function withinShare<T>(p: Promise<T>, ms = 500): Promise<T | 'hung'> {
  let timer!: ReturnType<typeof setTimeout>
  const hung = new Promise<'hung'>(r => { timer = setTimeout(() => r('hung'), ms) })
  try { return await Promise.race([p, hung]) } finally { clearTimeout(timer) }
}

const shareEndpoint = 'https://x.test/graphql'
const sharedOp = (extra: { timeout?: number; middleware?: Middleware[] } = {}) =>
  new Operation<{ id?: string }, { x: number | null }>({ operation: gql`query X($id: String) { x(id: $id) }`, share: true, ...extra })

describe('share (5.1.0) — each caller its own pipeline', () => {
  afterEach(() => vi.restoreAllMocks())

  // REST: "runs every caller's middleware"
  it("runs every caller's middleware, and sends once", async () => {
    const f = controllableGql(); vi.stubGlobal('fetch', f.fn)
    const seen = vi.fn()
    const mw: Middleware = (_ctx, next) => { seen(); return next() }
    const g = createGraphQL({ endpoint: shareEndpoint, middleware: [mw], operations: { getX: sharedOp() } })
    const all = Promise.all([g.getX({ id: '1' }), g.getX({ id: '1' }), g.getX({ id: '1' })])
    await flushShare()
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect(seen).toHaveBeenCalledTimes(3)
    f.calls[0].respond(200, { data: { x: 1 } })
    const rs = await all
    expect(rs.map(r => r.data)).toEqual([{ x: 1 }, { x: 1 }, { x: 1 }])
  })

  // REST: "does not share JSON bodies with the same content in a different key order"
  it('does not share the same variables in a different key order: the body is compared as sent', async () => {
    const f = controllableGql(); vi.stubGlobal('fetch', f.fn)
    const op = new Operation<{ a?: number; b?: number }, { x: number }>({ operation: gql`query X($a: Int, $b: Int) { x(a: $a, b: $b) }`, share: true })
    const g = createGraphQL({ endpoint: shareEndpoint, operations: { getX: op } })
    const all = Promise.all([g.getX({ a: 1, b: 2 }), g.getX({ b: 2, a: 1 })])
    await flushShare()
    expect(f.fn).toHaveBeenCalledTimes(2)
    f.calls[0].respond(200, { data: { x: 1 } }); f.calls[1].respond(200, { data: { x: 1 } })
    await all
  })

  // REST: "marks exactly one of two shared Results as joined"
  it('marks exactly one of two shared Results as joined', async () => {
    const f = controllableGql(); vi.stubGlobal('fetch', f.fn)
    const g = createGraphQL({ endpoint: shareEndpoint, operations: { getX: sharedOp() } })
    const all = Promise.all([g.getX({ id: '1' }), g.getX({ id: '1' })])
    await flushShare()
    expect(f.fn).toHaveBeenCalledTimes(1)
    f.calls[0].respond(200, { data: { x: 1 } })
    const rs = await all
    expect(rs.filter(r => wasJoined(r))).toHaveLength(1)
  })

  // REST: "lets one sharer abort without harming the others"
  it('lets one caller abort without harming the others', async () => {
    const f = controllableGql(); vi.stubGlobal('fetch', f.fn)
    const g = createGraphQL({ endpoint: shareEndpoint, operations: { getX: sharedOp() } })
    const ac = new AbortController()
    const a = g.getX({ id: '1' }, { signal: ac.signal })
    const b = g.getX({ id: '1' })
    await flushShare()
    expect(f.fn).toHaveBeenCalledTimes(1)
    ac.abort()
    expect((await a).error?.kind).toBe('abort')
    expect(f.calls[0].aborted()).toBe(false)
    f.calls[0].respond(200, { data: { x: 1 } })
    expect((await b).data).toEqual({ x: 1 })
  })

  // REST: "hands every caller a real Result when the shared fetch rejects, and reports it once"
  it('hands every caller its own network error when the shared fetch rejects, and reports it once', async () => {
    const f = controllableGql(); vi.stubGlobal('fetch', f.fn)
    const kinds: string[] = []
    const g = createGraphQL({ endpoint: shareEndpoint, onError: e => { kinds.push(e.kind) }, operations: { getX: sharedOp() } })
    const all = Promise.all([g.getX({ id: '1' }), g.getX({ id: '1' })])
    await flushShare()
    expect(f.fn).toHaveBeenCalledTimes(1)
    f.calls[0].reject(new TypeError('Failed to fetch'))
    const [a, b] = await all
    expect(a.error?.kind).toBe('network')
    expect(b.error?.kind).toBe('network')
    expect(a.error).not.toBe(b.error)
    await flushShare()
    expect(kinds).toEqual(['network'])
  })

  // REST: "own give-up racing a shared failure, at any offset: …". Whatever
  // the interleaving, the shared failure reports exactly once, and a caller's
  // own give-up reports only when that is what the caller ended with.
  it('own give-up racing a shared failure, at any offset: the failure reports once, the give-up only as itself', async () => {
    for (const failure of ['http', 'network'] as const) {
      for (let k = 0; k < 24; k++) {
        let answer!: () => void
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((res, rej) => {
          answer = failure === 'http'
            ? () => res(new Response('{}', { status: 500 }))
            : () => rej(new TypeError('Failed to fetch'))
        })))
        const kinds: string[] = []
        const g = createGraphQL({ endpoint: shareEndpoint, onError: e => { kinds.push(e.kind) }, operations: { getX: sharedOp() } })
        const ac = new AbortController()
        const a = g.getX({ id: '1' }, { signal: ac.signal })
        const b = g.getX({ id: '1' })
        await flushShare()
        answer()
        let p: Promise<unknown> = Promise.resolve()
        for (let i = 0; i < k; i++) p = p.then(() => {})
        void p.then(() => ac.abort(new DOMException('gave up', 'TimeoutError')))
        const [ra, rb] = await Promise.all([a, b])
        await flushShare()
        const at = `${failure}, k=${k}: ${kinds.join(',')}`
        expect(rb.error?.kind, at).toBe(failure)
        expect(kinds.filter(x => x === failure), at).toHaveLength(1)
        expect(kinds.filter(x => x === 'timeout'), at).toHaveLength(ra.error?.kind === 'timeout' ? 1 : 0)
      }
    }
  })
})

// REST: describe "one report per hung shared request", plus the per-call and
// client-timeout rows. A give-up to the operation's (or client's) deadline
// while waiting on a shared operation is that one failure, and carries the
// round trip's deadline token; a per-call timeout is the caller's own.
describe('share (5.1.0) — one report per hung shared operation', () => {
  afterEach(() => vi.restoreAllMocks())

  const timed = (timeout: number, middleware: Middleware[] = []) => {
    const kinds: string[] = []
    const g = createGraphQL({
      endpoint: shareEndpoint,
      middleware,
      onError: e => { kinds.push(e.kind) },
      operations: { getX: sharedOp({ timeout }) },
    })
    return { g, kinds }
  }

  it('reports a hung shared operation once when the callers arrive together', async () => {
    const f = controllableGql(); vi.stubGlobal('fetch', f.fn)
    const { g, kinds } = timed(30)
    const [a, b] = await Promise.all([g.getX({ id: '1' }), g.getX({ id: '1' })])
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect(a.error?.kind).toBe('timeout')
    expect(b.error?.kind).toBe('timeout')
    await flushShare()
    expect(kinds).toEqual(['timeout'])
  })

  it('reports a hung shared operation once behind an async global middleware', async () => {
    // The middleware delays every caller's send, so every caller's own copy
    // of the deadline starts before the shared request's and fires first.
    const f = controllableGql(); vi.stubGlobal('fetch', f.fn)
    const auth: Middleware = async (_ctx, next) => { await Promise.resolve(); return next() }
    const { g, kinds } = timed(30, [auth])
    const [a, b] = await Promise.all([g.getX({ id: '1' }), g.getX({ id: '1' })])
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect(a.error?.kind).toBe('timeout')
    expect(b.error?.kind).toBe('timeout')
    await flushShare()
    expect(kinds).toEqual(['timeout'])
  })

  it('still reports a real failure that arrives after a caller timed out', async () => {
    // A starts its deadline 40ms before it sends (its own middleware waits),
    // so it times out at 60ms while the shared request's deadline is not due
    // until about 100ms. The server then answers B with a 500: a different
    // failure, and it reports too.
    const f = controllableGql(); vi.stubGlobal('fetch', f.fn)
    const { g, kinds } = timed(60)
    const slowStart: Middleware = async (_ctx, next) => { await new Promise(r => setTimeout(r, 40)); return next() }
    const a = g.getX({ id: '1' }, { middleware: [slowStart] })
    await new Promise(r => setTimeout(r, 45))
    const b = g.getX({ id: '1' })
    await flushShare()
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect((await a).error?.kind).toBe('timeout')
    f.calls[0].respond(500, { errors: [{ message: 'down' }] })
    expect((await b).error?.kind).toBe('http')
    await flushShare()
    expect(kinds).toEqual(['timeout', 'http'])
  })

  // REST: row 2b
  it("reports once per caller when each caller's own per-call timeout ends it", async () => {
    const f = controllableGql(); vi.stubGlobal('fetch', f.fn)
    const kinds: string[] = []
    const g = createGraphQL({ endpoint: shareEndpoint, onError: e => { kinds.push(e.kind) }, operations: { getX: sharedOp() } })
    const a = g.getX({ id: '1' }, { timeout: 10 })
    const b = g.getX({ id: '1' }, { timeout: 10 })
    expect((await a).error?.kind).toBe('timeout')
    expect((await b).error?.kind).toBe('timeout')
    expect(f.fn).toHaveBeenCalledTimes(1)
    await flushShare()
    expect(kinds).toEqual(['timeout', 'timeout'])
  })

  // REST: "bounds a shared request with no endpoint timeout by the client
  // timeout". `timeout: 0` takes both callers' own budgets out of the race,
  // so only the shared request's deadline can end the hung round trip.
  it('bounds a shared operation with no operation timeout by the client timeout', async () => {
    const f = controllableGql(); vi.stubGlobal('fetch', f.fn)
    const kinds: string[] = []
    const g = createGraphQL({ endpoint: shareEndpoint, timeout: 20, onError: e => { kinds.push(e.kind) }, operations: { getX: sharedOp() } })
    const settled = await withinShare(Promise.all([g.getX({ id: '1' }, { timeout: 0 }), g.getX({ id: '1' }, { timeout: 0 })]))
    expect(settled).not.toBe('hung')
    const [a, b] = settled as Awaited<ReturnType<typeof g.getX>>[]
    expect(a.error?.kind).toBe('timeout')
    expect(b.error?.kind).toBe('timeout')
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect((f.calls[0].reason() as Error).name).toBe('TimeoutError')
    await flushShare()
    expect(kinds).toEqual(['timeout'])
  })

  // REST: "classifies the shared deadline as 'timeout' even when fetch rejects
  // with its own AbortError" (whatwg-fetch, React Native).
  it("classifies the shared deadline as 'timeout' even when fetch rejects with its own AbortError", async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')), { once: true })
    })))
    const { g, kinds } = timed(20)
    // `timeout: 0` takes the callers' own budgets out of the race, so the
    // shared deadline is what ends the request.
    const settled = await withinShare(Promise.all([g.getX({ id: '1' }, { timeout: 0 }), g.getX({ id: '1' }, { timeout: 0 })]))
    expect(settled).not.toBe('hung')
    const [a, b] = settled as Awaited<ReturnType<typeof g.getX>>[]
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(a.error?.kind).toBe('timeout')
    expect(b.error?.kind).toBe('timeout')
    expect((a.error?.body as DOMException).name).toBe('AbortError') // what fetch threw, as unshared
    await flushShare()
    expect(kinds).toEqual(['timeout'])
  })

  // REST: the slow response-side middleware rows. A middleware awaiting a
  // macrotask after next() outlives the backstop's grace period, so the
  // backstop settles every caller; its Result is still the one hung
  // operation's deadline, and carries that token — never the main one.
  const slowAfter = (ms: number): Middleware => async (_ctx, next) => {
    const result = await next()
    await new Promise(r => setTimeout(r, ms))
    return result
  }

  it('reports a hung shared operation once when every caller has slow response-side middleware', async () => {
    const f = controllableGql(); vi.stubGlobal('fetch', f.fn)
    const { g, kinds } = timed(30, [slowAfter(5)])
    const [a, b] = await Promise.all([g.getX({ id: '1' }), g.getX({ id: '1' })])
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect(a.error?.kind).toBe('timeout')
    expect(b.error?.kind).toBe('timeout')
    await new Promise(r => setTimeout(r, 20))
    expect(kinds).toEqual(['timeout'])
  })

  it("still reports per caller a per-call timeout the backstop settles: it is each caller's own", async () => {
    const f = controllableGql(); vi.stubGlobal('fetch', f.fn)
    const { g, kinds } = timed(0, [slowAfter(5)])
    const [a, b] = await Promise.all([g.getX({ id: '1' }, { timeout: 30 }), g.getX({ id: '1' }, { timeout: 30 })])
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect(a.error?.kind).toBe('timeout')
    expect(b.error?.kind).toBe('timeout')
    await new Promise(r => setTimeout(r, 20))
    expect(kinds).toEqual(['timeout', 'timeout'])
  })

  it("leaves a caller's timeout its own when the round trip answered and its own middleware ran out the deadline", async () => {
    const f = controllableGql(); vi.stubGlobal('fetch', f.fn)
    const { g, kinds } = timed(30, [slowAfter(60)])
    const a = g.getX({ id: '1' })
    const b = g.getX({ id: '1' })
    await flushShare()
    expect(f.fn).toHaveBeenCalledTimes(1)
    f.calls[0].respond(200, { data: { x: 1 } })
    expect((await a).error?.kind).toBe('timeout')
    expect((await b).error?.kind).toBe('timeout')
    await new Promise(r => setTimeout(r, 70))
    expect(kinds).toEqual(['timeout', 'timeout'])
  })

  it("never lets a caller the backstop settles at the deadline swallow another caller's real failure", async () => {
    const f = controllableGql(); vi.stubGlobal('fetch', f.fn)
    const { g, kinds } = timed(30)
    const a = g.getX({ id: '1' }, { middleware: [slowAfter(60)] })
    const b = g.getX({ id: '1' })
    await flushShare()
    expect(f.fn).toHaveBeenCalledTimes(1)
    f.calls[0].respond(500, { errors: [{ message: 'down' }] })
    expect((await b).error?.kind).toBe('http')
    expect((await a).error?.kind).toBe('timeout')
    await new Promise(r => setTimeout(r, 70))
    expect(kinds).toEqual(['http', 'timeout'])
  })
})

// REST: describe "a replaced signal does not hold the shared request". A
// middleware that replaces ctx.request.signal with one that never fires must
// not stop a caller's own cancel from letting go of the round trip; the
// give-up is classified by the signal the caller waited on, so a custom
// reason stays 'abort' — not 'network', and not reported.
describe('share (5.1.0) — a replaced signal does not hold the shared operation', () => {
  afterEach(() => vi.restoreAllMocks())

  it('releases a caller on its own cancel, and the last one abandons the request', async () => {
    const f = controllableGql(); vi.stubGlobal('fetch', f.fn)
    const neverFires: Middleware = (ctx, next) => { ctx.request.signal = new AbortController().signal; return next() }
    const onError = vi.fn()
    const g = createGraphQL({ endpoint: shareEndpoint, onError, operations: { getX: sharedOp({ middleware: [neverFires] }) } })
    const ac1 = new AbortController(), ac2 = new AbortController()
    const a = g.getX({ id: '1' }, { signal: ac1.signal })
    const b = g.getX({ id: '1' }, { signal: ac2.signal })
    await flushShare()
    expect(f.fn).toHaveBeenCalledTimes(1)

    ac1.abort(new Error('unmount'))
    const ra = await withinShare(a)
    expect(ra).not.toBe('hung')
    expect((ra as Awaited<typeof a>).error?.kind).toBe('abort')
    expect(f.calls[0].aborted()).toBe(false)

    ac2.abort(new Error('unmount'))
    const rb = await withinShare(b)
    expect((rb as Awaited<typeof b>).error?.kind).toBe('abort')
    expect(f.calls[0].reason()).toBe(ABANDONED)
    await flushShare()
    expect(onError).not.toHaveBeenCalled()
  })
})
