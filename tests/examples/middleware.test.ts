import { it, expect, vi, afterEach } from 'vitest'
import { mockFetch, jsonResponse, type RouteValue } from 'liaise/testing'

const getToken = () => 'token-1'
const signOut = vi.fn()

// example:middleware:start
import { createApi, defineRequest, type Middleware } from 'liaise'

type User = { id: string; name: string }

const auth: Middleware = async (ctx, next) => {
  // Before: change the request
  ctx.request.headers.set('Authorization', `Bearer ${getToken()}`)

  // Run the rest of the chain, ending in fetch
  const result = await next()

  // After: read or change the result
  if (result.error?.status === 401) signOut()
  return result
}

const getUser = defineRequest<User>()({ method: 'GET', path: '/users/:id' })

const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUser },
  middleware: [auth],
})
// example:middleware:end

let mock: ReturnType<typeof mockFetch>
const serve = (route: RouteValue) => {
  mock = mockFetch({ 'GET /users/:id': route })
  mock.install()
}
afterEach(() => { mock.restore(); signOut.mockClear() })

it('sets the header on the way in', async () => {
  serve(jsonResponse({ id: '42', name: 'Ada' }))
  const { data } = await api.getUser({ id: '42' })
  expect(mock.lastCall('GET /users/:id')?.headers.get('authorization')).toBe('Bearer token-1')
  expect(data).toEqual({ id: '42', name: 'Ada' })
  expect(signOut).not.toHaveBeenCalled()
})

it('sees the result on the way out, and the caller gets that same result', async () => {
  serve(jsonResponse({ message: 'token expired' }, { status: 401 }))
  const { error } = await api.getUser({ id: '42' })
  expect(signOut).toHaveBeenCalledTimes(1)
  expect(error?.status).toBe(401)
  expect(error?.body).toEqual({ message: 'token expired' })
})
