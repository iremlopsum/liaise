import { it, expect, afterEach, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import { mockFetch, jsonResponse } from 'liaise/testing'
import { createApi, defineRequest } from 'liaise'

type User = { id: string; name: string }
const api = createApi({
  baseUrl: '/api',
  requests: { getUser: defineRequest<User>()({ method: 'GET', path: '/users/:id' }) },
})
const mock = mockFetch({
  'GET /api/users/42': jsonResponse({ id: '42', name: 'Ada' }),
  'GET /api/users/404': jsonResponse({ message: 'no such user' }, { status: 404 }),
})
beforeEach(() => mock.install())
afterEach(() => mock.restore())

// readme:tanstack-query:start
import type { Result } from 'liaise'

// TanStack Query expects a failed query to throw. Do it here, at your edge.
async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
  const { data, error } = await call
  if (error) throw error
  return data
}

export const userQuery = (id: string) => ({
  queryKey: ['user', id],
  // TanStack's signal cancels the request when the query is no longer needed.
  queryFn: ({ signal }: { signal: AbortSignal }) => unwrap(api.getUser({ id }, { signal })),
})

// React:  useQuery(userQuery(id))
// Vue:    useQuery(computed(() => userQuery(id.value)))
// Svelte: createQuery(() => userQuery(id))
// Solid:  useQuery(() => userQuery(id()))
// readme:tanstack-query:end

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

it('resolves with data', async () => {
  await expect(client.fetchQuery(userQuery('42'))).resolves.toEqual({ id: '42', name: 'Ada' })
})

it('rejects with the ApiError, so TanStack sees a failed query', async () => {
  await expect(client.fetchQuery(userQuery('404'))).rejects.toMatchObject({ kind: 'http', status: 404 })
})
