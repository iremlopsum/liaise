import { it, expect } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

const mock = mockFetch({ 'GET /products/1': jsonResponse({ id: '1', name: 'Lamp' }) })
mock.install()

// example:share:start
import { createApi, defineRequest } from 'liaise'

type Product = { id: string; name: string }

const getProduct = defineRequest<Product>()({
  method: 'GET',
  path: '/products/:id',
  share: true,
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { getProduct } })

// One network request. Each caller gets its own Result from it.
const [a, b, c] = await Promise.all([
  api.getProduct({ id: '1' }),
  api.getProduct({ id: '1' }),
  api.getProduct({ id: '1' }),
])
// example:share:end

mock.restore()

it('three concurrent calls send one network request', () => {
  expect(mock.callCount('GET /products/1')).toBe(1)
})

it('each caller gets its own Result, with its own copy of data', () => {
  for (const r of [a, b, c]) {
    expect(r.error).toBeNull()
    expect(r.data).toEqual({ id: '1', name: 'Lamp' })
  }
  expect(a).not.toBe(b)
  expect(a.data).not.toBe(b.data)
  expect(b.data).not.toBe(c.data)
})

it('a call after the shared request has settled sends a new one', async () => {
  mock.install()
  await api.getProduct({ id: '1' })
  mock.restore()
  expect(mock.callCount('GET /products/1')).toBe(2)
})
