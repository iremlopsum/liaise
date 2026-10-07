import { it, expect, afterEach, vi, beforeEach } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

let mock: ReturnType<typeof mockFetch>
beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0) }) // full jitter → no wait
afterEach(() => { mock.restore(); vi.restoreAllMocks() })

// example:flaky-backend:start
import { createApi, defineRequest } from 'liaise'
import { retryMiddleware } from 'liaise/middleware'

type Report = { rows: number }

const retry = retryMiddleware({
  max: 3,
  // Retry server errors, rate limits and dropped connections. Not 4xx.
  retryOn: r => {
    const e = r.error
    return !!e && (e.status >= 500 || e.status === 429 || e.kind === 'network')
  },
})

const api = createApi({
  baseUrl: '/api',
  middleware: [retry],
  requests: {
    // timeout covers every attempt and every wait between them.
    getReport: defineRequest<Report>()({ method: 'GET', path: '/report', timeout: 3000 }),
  },
})
// example:flaky-backend:end

it('gets through a 503, a 429 and a dropped connection', async () => {
  mock = mockFetch({
    'GET /api/report': [
      jsonResponse({}, { status: 503 }),
      jsonResponse({}, { status: 429 }),
      () => { throw new TypeError('fetch failed') },
      jsonResponse({ rows: 3 }),
    ],
  })
  mock.install()
  const r = await api.getReport()
  expect(r.data).toEqual({ rows: 3 })
  expect(mock.callCount('GET /api/report')).toBe(4)
})

it('does not retry a 404', async () => {
  mock = mockFetch({ 'GET /api/report': jsonResponse({}, { status: 404 }) })
  mock.install()
  const r = await api.getReport()
  expect(r.error?.status).toBe(404)
  expect(mock.callCount('GET /api/report')).toBe(1)
})
