import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'
import { createApi, defineRequest } from 'liaise'

type Order = { id: string; items: string[] }
let shown: string[] = []
const show = (message: string) => { shown.push(message) }
const api = createApi({
  baseUrl: '/api',
  requests: {
    placeOrder: defineRequest<Order, { items: string[] }>()({ method: 'POST', path: '/orders', timeout: 50 }),
  },
})

// example:problem-after:start
async function submit(order: { items: string[] }) {
  const { data, error } = await api.placeOrder(order)
  if (!error) return show(`Order ${data.id} confirmed`)

  switch (error.kind) {
    case 'http':    return show(`The server said no (${error.status})`)
    case 'network': return show("You're offline. We'll try again.")
    case 'timeout': return show('This is taking too long. Try again.')
    case 'parse':   return show('The server sent something unexpected.')
  }
}
// example:problem-after:end

describe('the problem section, after', () => {
  let mock: ReturnType<typeof mockFetch>
  const serve = (route: Parameters<typeof mockFetch>[0][string]) => {
    mock = mockFetch({ 'POST /api/orders': route })
    mock.install()
  }
  beforeEach(() => { shown = [] })
  afterEach(() => mock.restore())

  it('confirms a placed order', async () => {
    serve(jsonResponse({ id: '7', items: ['a'] }, { status: 201 }))
    await submit({ items: ['a'] })
    expect(shown).toEqual(['Order 7 confirmed'])
  })
  it('names a 500 instead of treating it as success', async () => {
    serve(jsonResponse({ message: 'boom' }, { status: 500 }))
    await submit({ items: ['a'] })
    expect(shown).toEqual(['The server said no (500)'])
  })
  it('says offline when fetch itself fails', async () => {
    serve(() => { throw new TypeError('fetch failed') })
    await submit({ items: ['a'] })
    expect(shown).toEqual(["You're offline. We'll try again."])
  })
  it('gives up on a hung server at the deadline', async () => {
    serve(() => new Promise(() => {}))
    await submit({ items: ['a'] })
    expect(shown).toEqual(['This is taking too long. Try again.'])
  })
  it('reports broken JSON as unexpected', async () => {
    serve(new Response('{not json', { status: 200, headers: { 'content-type': 'application/json' } }))
    await submit({ items: ['a'] })
    expect(shown).toEqual(['The server sent something unexpected.'])
  })
})
