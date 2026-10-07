import { it, expect, afterEach, vi, beforeEach } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'
import { defineRequest } from 'liaise'

const Sentry = { captureException: vi.fn() }
const getUser = defineRequest<{ id: string }>()({ method: 'GET', path: '/users/:id' })
let mock: ReturnType<typeof mockFetch>
beforeEach(() => Sentry.captureException.mockClear())
afterEach(() => mock.restore())

// example:report-errors:start
import { createApi } from 'liaise'

const api = createApi({
  baseUrl: '/api',
  requests: { getUser },
  // Called once per failed call, after retries. Never for 'abort': you cancelled it.
  onError: error => {
    if (error.kind === 'http' && error.status < 500) return // expected 4xx, not a bug
    Sentry.captureException(error, {
      extra: { kind: error.kind, url: error.request.url, status: error.status },
    })
  },
})
// example:report-errors:end

const serve = (r: Response | (() => Response)) => { mock = mockFetch({ 'GET /api/users/:id': r }); mock.install() }

it('reports a 500', async () => {
  serve(jsonResponse({}, { status: 500 }))
  await api.getUser({ id: '1' })
  expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  expect(Sentry.captureException.mock.calls[0][1].extra).toMatchObject({ kind: 'http', status: 500, url: '/api/users/1' })
})

it('does not report a 404', async () => {
  serve(jsonResponse({}, { status: 404 }))
  await api.getUser({ id: '1' })
  expect(Sentry.captureException).not.toHaveBeenCalled()
})

it('does not report a call you cancelled', async () => {
  serve(jsonResponse({ id: '1' }))
  const c = new AbortController()
  c.abort()
  await api.getUser({ id: '1' }, { signal: c.signal })
  expect(Sentry.captureException).not.toHaveBeenCalled()
})
