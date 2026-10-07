import { it, expect } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

const rendered: unknown[] = []
const render = (items: unknown) => { rendered.push(items) }

// Three pages. The last one has no cursor.
const pages: Record<string, { items: { id: string; name: string }[]; cursor?: string }> = {
  start: { items: [{ id: '1', name: 'a' }, { id: '2', name: 'b' }], cursor: 'c2' },
  c2: { items: [{ id: '3', name: 'c' }, { id: '4', name: 'd' }], cursor: 'c3' },
  c3: { items: [{ id: '5', name: 'e' }] },
}
const mock = mockFetch({
  'GET /items': ({ request }) => jsonResponse(pages[new URL(request.url).searchParams.get('cursor') ?? 'start']),
})
mock.install()

// example:pagination:start
import { createApi, defineRequest, paginate } from 'liaise'

type Item = { id: string; name: string }
type Page = { items: Item[]; cursor?: string }

const listItems = defineRequest<Page, { limit: number; cursor?: string }>()({
  method: 'GET',
  path: '/items',
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { listItems } })

for await (const page of paginate(api.listItems, { limit: 50 }, {
  next: (p, prev) => (p.data.cursor ? { ...prev, cursor: p.data.cursor } : undefined),
})) {
  if (page.error) break
  render(page.data.items)
}
// example:pagination:end

mock.restore()

it('yields every page in order', () => {
  expect(rendered).toEqual([pages.start.items, pages.c2.items, pages.c3.items])
})

it('stops at the page with no cursor, after one request per page', () => {
  expect(mock.calls.map(c => c.url)).toEqual([
    'https://api.example.com/items?limit=50',
    'https://api.example.com/items?limit=50&cursor=c2',
    'https://api.example.com/items?limit=50&cursor=c3',
  ])
})

it('breaking out of the loop requests no further page', async () => {
  mock.install()
  const before = mock.calls.length
  for await (const page of paginate(api.listItems, { limit: 50 }, {
    next: (p, prev) => (p.data.cursor ? { ...prev, cursor: p.data.cursor } : undefined),
  })) {
    if (page.data) break // stop after the first page, although it has a cursor
  }
  mock.restore()
  expect(mock.calls.length - before).toBe(1)
})
