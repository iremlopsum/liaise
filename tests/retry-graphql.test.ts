// retryMiddleware on GraphQL: a mutation is never retried unless the middleware says
// `mutations: true`. A retried mutation can write twice.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createGraphQL, Operation, gql } from '../src/graphql.js'
import { retryMiddleware } from '../src/built-in-middleware.js'
import { withHeaders } from '../src/with-headers.js'
import type { Middleware } from '../src/types.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const QUERY = gql`query User { user { id } }`
const MUTATION = gql`mutation Save { save { id } }`
const failing = () => {
  const fetch = vi.fn(async () => new Response('{}', { status: 503 }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
const fast = { max: 2, baseDelay: 1, jitter: false } as const
const split = (middleware: Middleware[], saveMiddleware: Middleware[] = []) => createGraphQL({
  endpoint: 'https://x.test/graphql',
  middleware,
  queries: { user: new Operation<Record<string, never>, unknown>({ operation: QUERY }) },
  mutations: { save: new Operation<Record<string, never>, unknown>({ operation: MUTATION, middleware: saveMiddleware }) },
})

describe('retryMiddleware on GraphQL', () => {
  it('retries a query', async () => {
    const fetch = failing()
    await split([retryMiddleware(fast)]).query.user()
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('sends a mutation once, without asking retryOn or calling onRetry', async () => {
    const fetch = failing()
    const retryOn = vi.fn(() => true)
    const onRetry = vi.fn()
    await split([retryMiddleware({ ...fast, retryOn, onRetry })]).mutation.save()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(retryOn).not.toHaveBeenCalled()
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('retries a mutation with mutations: true', async () => {
    const fetch = failing()
    await split([retryMiddleware({ ...fast, mutations: true })]).mutation.save()
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('a client-level retry and an operation-level mutations: true retry make 3 attempts, not 9', async () => {
    const fetch = failing()
    await split([retryMiddleware(fast)], [retryMiddleware({ ...fast, mutations: true })]).mutation.save()
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it("sends a flat client's mutation document once", async () => {
    const fetch = failing()
    const client = createGraphQL({
      endpoint: 'https://x.test/graphql',
      middleware: [retryMiddleware(fast)],
      operations: { save: new Operation<Record<string, never>, unknown>({ operation: MUTATION }) },
    })
    await client.save()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('sends a withHeaders copy’s mutation once', async () => {
    const fetch = failing()
    await withHeaders(split([retryMiddleware(fast)]), { 'x-a': '1' }).mutation.save()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
