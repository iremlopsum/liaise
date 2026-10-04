import { it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'
import { defineRequest } from 'liaise'

type User = { id: string; name: string }
const getUser = defineRequest<User>()({ method: 'GET', path: '/users/:id' })

const controllers: AbortController[] = []
beforeEach(() => {
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
    const c = new AbortController()
    controllers.push(c)
    return c.signal
  })
})
const mock = mockFetch({
  'GET /api/users/:id': [() => new Promise<Response>(() => {}), jsonResponse({ id: '1', name: 'Ada' })],
})
mock.install()
afterEach(() => { mock.restore(); vi.restoreAllMocks() })

// readme:per-attempt-timeout:start
import { createApi } from 'liaise'
import type { Middleware } from 'liaise'
import { retryMiddleware } from 'liaise/middleware'

// A fresh time limit for each attempt, instead of one for the whole call.
const perAttempt = (ms: number): Middleware => async (ctx, next) => {
  ctx.request.signal = AbortSignal.timeout(ms)
  return next()
}

const api = createApi({
  baseUrl: '/api',
  requests: { getUser },
  // Order matters: retry wraps perAttempt, so every attempt gets its own 5 s.
  middleware: [
    retryMiddleware({ retryOn: r => r.error?.kind === 'timeout' || (r.error?.status ?? 0) >= 500 }),
    perAttempt(5_000),
  ],
})
// readme:per-attempt-timeout:end

it('a timed-out attempt is retried with a fresh limit', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const pending = api.getUser({ id: '1' })
  await new Promise(r => setTimeout(r, 0))
  controllers[0].abort(new DOMException('The operation timed out.', 'TimeoutError'))
  const r = await pending
  expect(r.data).toEqual({ id: '1', name: 'Ada' })
  expect(controllers).toHaveLength(2)
})
