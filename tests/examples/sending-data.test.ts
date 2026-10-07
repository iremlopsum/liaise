import { it, expect } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

const mock = mockFetch({
  'GET /orgs/:org/items': jsonResponse([]),
  'POST /orgs/:org/items': jsonResponse({ id: '1', name: 'Lamp' }, { status: 201 }),
})
mock.install()

// example:sending-data:start
import { createApi, defineRequest } from 'liaise'

type Item = { id: string; name: string }

const listItems = defineRequest<Item[], { page: number; tags: string[] }>()({
  method: 'GET',
  path: '/orgs/:org/items',
})
const createItem = defineRequest<Item, { name: string }>()({
  method: 'POST',
  path: '/orgs/:org/items',
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { listItems, createItem } })

await api.listItems({ org: 'acme', page: 2, tags: ['a', 'b'] })
// GET /orgs/acme/items?page=2&tags=a&tags=b

await api.createItem({ org: 'acme', name: 'Lamp' })
// POST /orgs/acme/items, with the JSON body {"name":"Lamp"}
// example:sending-data:end

mock.restore()

it('a GET puts the params the path does not name in the query string, arrays as repeated keys', () => {
  const [get] = mock.calls
  expect(get.method).toBe('GET')
  expect(get.url).toBe('https://api.example.com/orgs/acme/items?page=2&tags=a&tags=b')
  expect(get.body).toBeNull()
})

it('a POST sends them as a JSON body, with Content-Type set for you', () => {
  const [, post] = mock.calls
  expect(post.method).toBe('POST')
  expect(post.url).toBe('https://api.example.com/orgs/acme/items')
  expect(post.body).toBe('{"name":"Lamp"}')
  expect(post.headers.get('content-type')).toBe('application/json')
})
