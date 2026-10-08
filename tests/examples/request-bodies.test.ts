import { it, expect } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

const mock = mockFetch({
  'PATCH /users/:id': jsonResponse({ id: '7', name: 'Grace' }),
  'POST /orders': jsonResponse({ id: 'o1' }, { status: 201 }),
  'POST /items/bulk': jsonResponse({ created: 2 }, { status: 201 }),
})
mock.install()

// example:request-bodies:start
import { createApi, defineRequest } from 'liaise'

type User = { id: string; name: string }
type Order = { id: string }
type Line = { sku: string; qty: number }

const updateUser = defineRequest<User, { name: string }>()({
  method: 'PATCH',
  path: '/users/:id',
})
const placeOrder = defineRequest<Order, { customer: { id: string }; lines: Line[] }>()({
  method: 'POST',
  path: '/orders',
})
const createItems = defineRequest<{ created: number }, { name: string }[]>()({
  method: 'POST',
  path: '/items/bulk?dryRun=false',
})

const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { updateUser, placeOrder, createItems },
})

await api.updateUser({ id: '7', name: 'Grace' })
// PATCH /users/7, with the JSON body {"name":"Grace"}

await api.placeOrder({ customer: { id: 'c1' }, lines: [{ sku: 'lamp', qty: 2 }] })
// POST /orders, with the JSON body {"customer":{"id":"c1"},"lines":[{"sku":"lamp","qty":2}]}

await api.createItems([{ name: 'Lamp' }, { name: 'Desk' }])
// POST /items/bulk?dryRun=false, with the JSON body [{"name":"Lamp"},{"name":"Desk"}]
// example:request-bodies:end

mock.restore()

it('a path param fills the path and is left out of the body', () => {
  const [patch] = mock.calls
  expect(patch.method).toBe('PATCH')
  expect(patch.url).toBe('https://api.example.com/users/7')
  expect(patch.body).toBe('{"name":"Grace"}')
  expect(patch.headers.get('content-type')).toBe('application/json')
})

it('nested objects and arrays inside the body are sent as JSON', () => {
  const [, order] = mock.calls
  expect(order.url).toBe('https://api.example.com/orders')
  expect(order.body).toBe('{"customer":{"id":"c1"},"lines":[{"sku":"lamp","qty":2}]}')
})

it('an array as params is sent as a JSON array, with the path\'s fixed query string kept', () => {
  const [, , bulk] = mock.calls
  expect(bulk.url).toBe('https://api.example.com/items/bulk?dryRun=false')
  expect(bulk.body).toBe('[{"name":"Lamp"},{"name":"Desk"}]')
  expect(bulk.headers.get('content-type')).toBe('application/json')
})
