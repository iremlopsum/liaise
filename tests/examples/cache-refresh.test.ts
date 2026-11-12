import { it, expect, afterEach } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

let mock: ReturnType<typeof mockFetch>
afterEach(() => mock.restore())

// example:cache-refresh:start
import { createApi, defineRequest } from 'liaise'
import { cacheMiddleware } from 'liaise/middleware'

type User = { id: string; name: string }

const getUserCache = cacheMiddleware({ ttl: 5 * 60_000, maxSize: 100 })

const getUser = defineRequest<User>()({
  method: 'GET',
  path: '/users/:id',
  middleware: [getUserCache],
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { getUser } })

// After an edit, refresh the entry: the call goes to the network, and its answer
// replaces the cached one, so the next read gets it without a request.
async function afterEdit(id: string) {
  return api.getUser({ id }, { skipMiddleware: [getUserCache] })
}

// On logout, clear every cached entry:
function onLogout() {
  getUserCache.clear()
}
// example:cache-refresh:end

it('a refresh replaces the entry, the next read is served from it, and logout clears it', async () => {
  mock = mockFetch({
    'GET /users/42': [
      jsonResponse({ id: '42', name: 'Ann' }),
      jsonResponse({ id: '42', name: 'Ann B.' }),
      jsonResponse({ id: '42', name: 'Ann C.' }),
    ],
  })
  mock.install()
  await api.getUser({ id: '42' })
  const fresh = await afterEdit('42')
  const next = await api.getUser({ id: '42' })
  expect(fresh.data).toEqual({ id: '42', name: 'Ann B.' })
  expect(next).toBe(fresh)
  expect(mock.callCount('GET /users/42')).toBe(2)
  expect(() => { (next.data as User).name = 'x' }).toThrow(TypeError) // stored data is frozen

  onLogout()
  expect((await api.getUser({ id: '42' })).data).toEqual({ id: '42', name: 'Ann C.' })
  expect(mock.callCount('GET /users/42')).toBe(3)
})
