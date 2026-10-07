import { it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

let mock: ReturnType<typeof mockFetch>
beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0) }) // full jitter → no wait
afterEach(() => { mock.restore(); vi.restoreAllMocks() })

// example:retry-idempotent:start
import { createApi, defineRequest } from 'liaise'
import { retryMiddleware } from 'liaise/middleware'

type Order = { id: string }

// Methods that are safe to send twice. A POST is not: a 5xx after it may
// mean the server already created the order.
const IDEMPOTENT = ['GET', 'HEAD', 'PUT', 'DELETE']

const retry = retryMiddleware({
  max: 2,
  retryOn: r => !!r.error && r.error.status >= 500 && IDEMPOTENT.includes(r.error.request.method),
})

const api = createApi({
  baseUrl: 'https://api.example.com',
  middleware: [retry],
  requests: {
    getOrder: defineRequest<Order>()({ method: 'GET', path: '/orders/:id' }),
    createOrder: defineRequest<Order>()({ method: 'POST', path: '/orders' }),
  },
})
// example:retry-idempotent:end

it('retries a GET that got a 503', async () => {
  mock = mockFetch({ 'GET /orders/:id': [jsonResponse({}, { status: 503 }), jsonResponse({ id: '7' })] })
  mock.install()
  const { data, error } = await api.getOrder({ id: '7' })
  expect(error).toBeNull()
  expect(data).toEqual({ id: '7' })
  expect(mock.callCount('GET /orders/:id')).toBe(2)
})

it('sends a POST that got a 503 once, and returns the 503', async () => {
  mock = mockFetch({ 'POST /orders': [jsonResponse({}, { status: 503 }), jsonResponse({ id: '8' })] })
  mock.install()
  const { error } = await api.createOrder()
  expect(error).toMatchObject({ kind: 'http', status: 503 })
  expect(mock.callCount('POST /orders')).toBe(1)
})
