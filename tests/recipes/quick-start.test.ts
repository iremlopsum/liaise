import { it, expect, vi } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

const mock = mockFetch({
  'GET /users/:id': ({ params }) => jsonResponse({ id: params.id, name: 'Ada', email: 'ada@example.com' }),
  'POST /users': jsonResponse({ id: '43', name: 'Grace', email: 'grace@example.com' }, { status: 201 }),
})
mock.install()
const log = vi.spyOn(console, 'log').mockImplementation(() => {})
const err = vi.spyOn(console, 'error').mockImplementation(() => {})

// example:quick-start:start
import { createApi, defineRequest } from 'liaise'

type User = { id: string; name: string; email: string }

// 1. Describe your endpoints. The path decides which params are required.
const getUser = defineRequest<User>()({ method: 'GET', path: '/users/:id' })
const createUser = defineRequest<User, { name: string; email: string }>()({
  method: 'POST',
  path: '/users',
})

// 2. Create the client. There is no default timeout: without one, a server
//    that never answers keeps the call waiting.
const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUser, createUser },
  timeout: 10_000,
})

// 3. Call it. This never throws: you always get { data, error }.
const { data, error } = await api.getUser({ id: '42' })

if (error) {
  // error.kind says what went wrong: 'http', 'network', 'timeout', ...
  console.error(error.kind, error.status)
} else {
  console.log(data.name) // data is a User here
}

// A POST sends its params as a JSON body.
const created = await api.createUser({ name: 'Grace', email: 'grace@example.com' })
if (!created.error) console.log(created.data.id)
// example:quick-start:end

mock.restore()

it('runs the quick start against a stubbed server', () => {
  expect(log.mock.calls).toEqual([['Ada'], ['43']])
  expect(err).not.toHaveBeenCalled()
  expect(mock.lastCall('GET /users/:id')?.url).toBe('https://api.example.com/users/42')
})

it('createUser sends its params as a JSON body', () => {
  expect(JSON.parse(String(mock.lastCall('POST /users')?.body))).toEqual({ name: 'Grace', email: 'grace@example.com' })
})

it('sets a 10 second deadline', async () => {
  const spy = vi.spyOn(AbortSignal, 'timeout')
  mock.install()
  await api.getUser({ id: '42' })
  mock.restore()
  expect(spy).toHaveBeenCalledWith(10_000)
  spy.mockRestore()
})
