import { it, expect } from 'vitest'
import { createApi, defineRequest } from 'liaise'

type User = { id: string; name: string }
// Your app's client. A real test imports it from your own code.
const api = createApi({
  baseUrl: '/api',
  requests: {
    getUser: defineRequest<User>()({ method: 'GET', path: '/users/:id' }),
    createUser: defineRequest<{ id: string }, { name: string }>()({ method: 'POST', path: '/users' }),
  },
})
const originalFetch = globalThis.fetch

// example:testing:start
import { mockFetch, jsonResponse } from 'liaise/testing'

const mock = mockFetch({
  'GET /api/users/:id': ({ params }) => jsonResponse({ id: params.id, name: 'Ada' }),
  'POST /api/users': jsonResponse({ id: 'new-user' }, { status: 201 }),
})

mock.install()   // replaces globalThis.fetch
const { data } = await api.getUser({ id: '42' })   // your code, calling the real client
mock.restore()   // puts the original globalThis.fetch back
// example:testing:end

it('runs the real client against the stub: the :id token reaches the route function', () => {
  expect(data).toEqual({ id: '42', name: 'Ada' })
})

it('records the call, keyed like the routes', () => {
  expect(mock.callCount('GET /api/users/:id')).toBe(1)
  const call = mock.lastCall('GET /api/users/:id')!
  expect(call.method).toBe('GET')
  expect(call.url).toBe('/api/users/42')
  expect(call.body).toBeNull()
})

it('restore() puts the original fetch back', () => {
  expect(globalThis.fetch).toBe(originalFetch)
})

it('a route value can be a Response, sent as is', async () => {
  mock.install()
  const { data: created, response } = await api.createUser({ name: 'Grace' })
  mock.restore()
  expect(response?.status).toBe(201)
  expect(created).toEqual({ id: 'new-user' })
  expect(mock.lastCall('POST /api/users')?.body).toBe('{"name":"Grace"}')
})

it('an array is a sequence, and its last entry repeats', async () => {
  const flaky = mockFetch({
    'GET /api/users/:id': [jsonResponse(null, { status: 503 }), jsonResponse({ id: '1', name: 'Ada' })],
  })
  flaky.install()
  const statuses = []
  for (let i = 0; i < 3; i++) statuses.push((await api.getUser({ id: '1' })).response?.status)
  flaky.restore()
  expect(statuses).toEqual([503, 200, 200])
})

it("an unmatched route is a 'network' error naming the request and the routes", async () => {
  const typo = mockFetch({ 'GET /api/user/:id': jsonResponse({}) })
  typo.install()
  const r = await api.getUser({ id: '42' })
  typo.restore()
  expect(r.error?.kind).toBe('network')
  expect(String(r.error?.body)).toMatch(/no route matched GET \/api\/users\/42/)
  expect(String(r.error?.body)).toMatch(/Defined routes: GET \/api\/user\/:id/)
})
