import { it, expect } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

const mock = mockFetch({
  'GET /orgs/:org/repos': jsonResponse([{ id: 1, name: 'liaise' }]),
})
mock.install()

// example:define-endpoints:start
import { createApi, defineRequest } from 'liaise'

type Repo = { id: number; name: string }

// The first type is the response. The second is the params the path doesn't name.
const listRepos = defineRequest<Repo[], { page?: number }>()({
  method: 'GET',
  path: '/orgs/:org/repos',
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { listRepos } })

await api.listRepos({ org: 'acme' })           // GET /orgs/acme/repos
await api.listRepos({ org: 'acme', page: 2 })  // GET /orgs/acme/repos?page=2

// Leaving out org doesn't compile:
// await api.listRepos({ page: 2 })
// example:define-endpoints:end

mock.restore()

it('fills org into the path and sends page in the query string', () => {
  expect(mock.calls.map(c => c.url)).toEqual([
    'https://api.example.com/orgs/acme/repos',
    'https://api.example.com/orgs/acme/repos?page=2',
  ])
})

it('resolves with the typed response', async () => {
  mock.install()
  const { data, error } = await api.listRepos({ org: 'acme' })
  mock.restore()
  expect(error).toBeNull()
  expect(data).toEqual([{ id: 1, name: 'liaise' }])
})

it('refuses a call without org at compile time', () => {
  // @ts-expect-error org is required
  const call = () => api.listRepos({ page: 2 })
  expect(call).toBeTypeOf('function')
})

it('refuses an org that is still undefined at runtime, before anything is sent', async () => {
  const before = mock.calls.length
  mock.install()
  const org = undefined as unknown as string // an id that hasn't loaded yet
  const { error } = await api.listRepos({ org })
  mock.restore()
  expect(error?.kind).toBe('network')
  expect(String(error?.body)).toMatch(/:org/)
  expect(mock.calls.length).toBe(before)
})
