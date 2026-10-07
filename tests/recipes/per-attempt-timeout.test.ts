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

// example:per-attempt-timeout:start
import { createApi } from 'liaise'
import type { Middleware } from 'liaise'
import { retryMiddleware } from 'liaise/middleware'

// A fresh time limit for each attempt, on top of the caller's own signal.
const perAttempt = (ms: number): Middleware => async (ctx, next) => {
  const caller = ctx.request.signal // the caller's signal and deadline, if any
  const limit = AbortSignal.timeout(ms)
  const attempt = new AbortController()
  const stop = () => attempt.abort(caller?.aborted ? caller.reason : limit.reason)
  if (caller?.aborted) stop()
  caller?.addEventListener('abort', stop)
  limit.addEventListener('abort', stop)
  ctx.request.signal = attempt.signal
  try {
    return await next()
  } finally {
    caller?.removeEventListener('abort', stop)
    limit.removeEventListener('abort', stop)
    ctx.request.signal = caller // the next attempt starts from the caller's signal again
  }
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
// example:per-attempt-timeout:end

it('a timed-out attempt is retried with a fresh limit', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  const pending = api.getUser({ id: '1' })
  await new Promise(r => setTimeout(r, 0))
  controllers[0].abort(new DOMException('The operation timed out.', 'TimeoutError'))
  const r = await pending
  expect(r.data).toEqual({ id: '1', name: 'Ada' })
  expect(controllers).toHaveLength(2)
})

it("the caller's cancel stops the request in flight", async () => {
  let sent: AbortSignal | undefined
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
    sent = init.signal ?? undefined
    return new Promise<Response>(() => {})
  })
  try {
    const caller = new AbortController()
    const pending = api.getUser({ id: '1' }, { signal: caller.signal })
    await new Promise(r => setTimeout(r, 0))
    caller.abort()
    const r = await pending
    expect(r.error?.kind).toBe('abort')
    expect(sent?.aborted).toBe(true)
  } finally {
    vi.unstubAllGlobals()
  }
})
