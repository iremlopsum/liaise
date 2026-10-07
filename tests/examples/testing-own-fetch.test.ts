import { it, expect, vi } from 'vitest'

// Stands in for the global fetch, so the test can prove the client never calls it.
const globalFetch = vi.fn(async () => new Response('the global fetch was called', { status: 500 }))
vi.stubGlobal('fetch', globalFetch)

// example:testing-own-fetch:start
import { createApi, defineRequest } from 'liaise'
import { mockFetch, jsonResponse } from 'liaise/testing'

type User = { id: string; name: string }

const mock = mockFetch({ 'GET /api/users/:id': jsonResponse({ id: '42', name: 'Ada' }) })
const api = createApi({
  baseUrl: '/api',
  requests: { getUser: defineRequest<User>()({ method: 'GET', path: '/users/:id' }) },
  fetch: mock.fetch,   // this client sends with the stub
})

const { data } = await api.getUser({ id: '42' })
// example:testing-own-fetch:end

vi.unstubAllGlobals()

it('the client sends with the stub it was given, and never with the global fetch', () => {
  expect(data).toEqual({ id: '42', name: 'Ada' })
  expect(mock.callCount('GET /api/users/:id')).toBe(1)
  expect(globalFetch).not.toHaveBeenCalled()
})
