import { it, expect, afterEach } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

// The server: orders need the current access token; refresh tokens rotate, so
// a second refresh with an already-used token is refused (the stampede bug).
let currentRefresh = 'r1'
const mock = mockFetch({
  'POST /api/auth/refresh': async ({ request }) => {
    const { token } = await request.json() as { token: string }
    if (token !== currentRefresh) return jsonResponse({ message: 'refresh token already used' }, { status: 401 })
    currentRefresh = 'r2'
    await new Promise(r => setTimeout(r, 20))
    return jsonResponse({ access: 'fresh', refresh: 'r2' })
  },
  'GET /api/orders': ({ request }) =>
    request.headers.get('authorization') === 'Bearer fresh'
      ? jsonResponse([{ id: '1', total: 30 }])
      : jsonResponse({ message: 'token expired' }, { status: 401 }),
})
mock.install()
afterEach(() => mock.restore())

// readme:auth-refresh:start
import { createApi, defineRequest, type Middleware } from 'liaise'

type Tokens = { access: string; refresh: string }
type Order = { id: string; total: number }

let tokens: Tokens = { access: 'expired', refresh: 'r1' }

const auth: Middleware = async (ctx, next) => {
  if (ctx.requestName === 'refresh') return next()

  const sentWith = tokens.access
  ctx.request.headers.set('Authorization', `Bearer ${sentWith}`)
  const result = await next()
  if (result.error?.status !== 401) return result

  // Refresh only if nobody has done it since this call was sent. Every call
  // that gets here at the same moment joins one refresh request (share: true).
  if (tokens.access === sentWith) {
    const refreshed = await api.refresh({ token: tokens.refresh })
    if (refreshed.error) return result // refresh failed: keep the 401
    tokens = refreshed.data
  }
  ctx.request.headers.set('Authorization', `Bearer ${tokens.access}`)
  return next() // send the call again with the new token
}

const api = createApi({
  baseUrl: '/api',
  middleware: [auth],
  requests: {
    refresh: defineRequest<Tokens, { token: string }>()({
      method: 'POST',
      path: '/auth/refresh',
      share: true,
    }),
    getOrders: defineRequest<Order[]>()({ method: 'GET', path: '/orders' }),
  },
})
// readme:auth-refresh:end

it('five calls that all get a 401 cause one refresh, and all five succeed', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => api.getOrders()))
  expect(mock.callCount('POST /api/auth/refresh')).toBe(1)
  expect(results.every(r => r.error === null)).toBe(true)
  expect(results[0].data).toEqual([{ id: '1', total: 30 }])
})
