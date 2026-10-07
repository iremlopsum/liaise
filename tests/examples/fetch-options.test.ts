import { it, expect } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

const mock = mockFetch({
  'GET /me': jsonResponse({ id: '1', name: 'Ada' }),
  'GET /users/:id': ({ params }) => jsonResponse({ id: params.id, name: 'Grace' }),
})
mock.install()

// example:fetch-options:start
import { createApi, defineRequest } from 'liaise'

type User = { id: string; name: string }

const api = createApi({
  baseUrl: 'https://api.example.com',
  // Send the session cookie on every call, to an API on another origin.
  fetchOptions: { credentials: 'include' },
  requests: {
    getMe: defineRequest<User>()({ method: 'GET', path: '/me' }),
    // Answers change often: skip the browser's HTTP cache for this endpoint.
    getUser: defineRequest<User>()({ method: 'GET', path: '/users/:id', fetchOptions: { cache: 'no-store' } }),
  },
})

const me = await api.getMe()
// keepalive lets this one call finish even if the page is closing.
const user = await api.getUser({ id: '2' }, { fetchOptions: { keepalive: true } })
// example:fetch-options:end

mock.restore()

it('each level reaches fetch, merged field by field', () => {
  expect(me.data?.name).toBe('Ada')
  expect(user.data?.name).toBe('Grace')
  expect(mock.lastCall('GET /me')?.init.credentials).toBe('include')
  expect(mock.lastCall('GET /users/:id')?.init).toMatchObject({ credentials: 'include', cache: 'no-store', keepalive: true })
})
