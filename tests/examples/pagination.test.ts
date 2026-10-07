import { it, expect, vi, afterAll } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

// The reader's own UI code, which the example only calls.
const rendered: unknown[] = []
const render = (items: unknown) => { rendered.push(items) }
const showError = vi.fn<(error: unknown) => void>()
const hideLoadMore = vi.fn<() => void>()

// Three pages. The last one has no cursor.
const serverPages: Record<string, { items: { id: string; name: string }[]; cursor?: string }> = {
  start: { items: [{ id: '1', name: 'a' }, { id: '2', name: 'b' }], cursor: 'c2' },
  c2: { items: [{ id: '3', name: 'c' }, { id: '4', name: 'd' }], cursor: 'c3' },
  c3: { items: [{ id: '5', name: 'e' }] },
}
const mock = mockFetch({
  'GET /items': ({ request }) => jsonResponse(serverPages[new URL(request.url).searchParams.get('cursor') ?? 'start']),
})
// Installed for the whole file: the example only sets up loadMore, and the tests below are the clicks.
mock.install()
afterAll(() => mock.restore())

// example:pagination:start
import { createApi, defineRequest, paginate } from 'liaise'

type Item = { id: string; name: string }
type Page = { items: Item[]; cursor?: string }

const listItems = defineRequest<Page, { limit: number; cursor?: string }>()({
  method: 'GET',
  path: '/items',
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { listItems } })

const pages = paginate(api.listItems, { limit: 50 }, {
  next: (p, prev) => (p.data.cursor ? { ...prev, cursor: p.data.cursor } : undefined),
})
// Nothing has been fetched yet.

async function loadMore() {
  const { value: page, done } = await pages.next() // one request per click
  if (done) return hideLoadMore()
  if (page.error) return showError(page.error)
  render(page.data.items)
}
// example:pagination:end

it('creating the generator sends no request', () => {
  expect(mock.calls).toEqual([])
})

it('the first loadMore sends one request, for the first page, and renders it', async () => {
  await loadMore()
  expect(mock.calls.map(c => c.url)).toEqual(['https://api.example.com/items?limit=50'])
  expect(rendered).toEqual([serverPages.start.items])
})

it('the second sends one more, with the cursor the first page returned', async () => {
  await loadMore()
  expect(mock.calls.map(c => c.url)).toEqual([
    'https://api.example.com/items?limit=50',
    'https://api.example.com/items?limit=50&cursor=c2',
  ])
  expect(rendered).toEqual([serverPages.start.items, serverPages.c2.items])
})

it('after the last page, the next loadMore hides the button and sends nothing', async () => {
  await loadMore() // the third page, which has no cursor
  expect(rendered).toHaveLength(3)
  expect(hideLoadMore).not.toHaveBeenCalled()

  await loadMore()
  expect(hideLoadMore).toHaveBeenCalledTimes(1)
  expect(mock.calls).toHaveLength(3)
  expect(showError).not.toHaveBeenCalled()
})
