import { it, expect, vi, afterAll } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

// The reader's own UI code, which the example only calls.
type Info = { loading: boolean; hasNext: boolean }
const rendered: { ids: string[]; info: Info }[] = []
const render = (items: readonly { id: string }[], info: Info) => { rendered.push({ ids: items.map(i => i.id), info }) }

// sessionStorage, as a browser tab has it: it survives a reload.
const stored = new Map<string, string>()
const writes: string[] = []
vi.stubGlobal('sessionStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value); writes.push(value) },
})

// Four pages of two posts. The last one has no next cursor.
const serverPages: Record<string, { items: { id: string; title: string }[]; next: string | null }> = {
  start: { items: [{ id: '1', title: 'a' }, { id: '2', title: 'b' }], next: 'c2' },
  c2: { items: [{ id: '3', title: 'c' }, { id: '4', title: 'd' }], next: 'c3' },
  c3: { items: [{ id: '5', title: 'e' }, { id: '6', title: 'f' }], next: 'c4' },
  c4: { items: [{ id: '7', title: 'g' }], next: null },
}
const mock = mockFetch({
  'GET /posts': ({ request }) => jsonResponse(serverPages[new URL(request.url).searchParams.get('cursor') ?? 'start']),
})
mock.install()
afterAll(() => { mock.restore(); vi.unstubAllGlobals() })

const urls = () => mock.calls.map(c => c.url)
const idle = (pager: { state: { loading: boolean } }) => vi.waitFor(() => expect(pager.state.loading).toBe(false))

// example:pager-list:start
import { createApi, defineRequest, createPager } from 'liaise'

type Post = { id: string; title: string }
type Page = { items: Post[]; next: string | null }

const listPosts = defineRequest<Page, { limit: number; cursor?: string }>()({ method: 'GET', path: '/posts' })
const api = createApi({ baseUrl: 'https://api.example.com', requests: { listPosts } })

function openFeed() {
  const feed = createPager(api.listPosts, { limit: 20 }, {
    next: (r, params) => (r.data.next ? { ...params, cursor: r.data.next } : undefined),
    items: r => r.data.items,
    // As many pages as the reader had before a reload.
    restore: Number(sessionStorage.getItem('feed:pages')) || 1,
  })
  feed.subscribe(() => {
    const { items, loaded, loading, hasNext } = feed.state
    render(items, { loading, hasNext })
    if (!loading) sessionStorage.setItem('feed:pages', String(loaded))
  })
  feed.load()
  return feed
}

const feed = openFeed()
// Your scroll handler calls feed.next() when the reader nears the end of the list.
// example:pager-list:end

it('opening the feed loads the first page', async () => {
  await idle(feed)
  expect(urls()).toEqual(['https://api.example.com/posts?limit=20'])
  expect(rendered.at(-1)).toEqual({ ids: ['1', '2'], info: { loading: false, hasNext: true } })
  expect(stored.get('feed:pages')).toBe('1')
})

it('next() appends the next page to the items, and the page count is saved', async () => {
  await feed.next()
  await feed.next()
  expect(urls().slice(1)).toEqual([
    'https://api.example.com/posts?limit=20&cursor=c2',
    'https://api.example.com/posts?limit=20&cursor=c3',
  ])
  expect(rendered.at(-1)).toEqual({ ids: ['1', '2', '3', '4', '5', '6'], info: { loading: false, hasNext: true } })
  expect(feed.state.loaded).toBe(3)
  expect(stored.get('feed:pages')).toBe('3')
})

it('after a reload, the feed asks for pages 1 to 3 again, one after another, and shows all of them', async () => {
  mock.calls.length = 0
  rendered.length = 0
  writes.length = 0
  const reloaded = openFeed() // restore: 3, read from sessionStorage
  await idle(reloaded)
  expect(urls()).toEqual([
    'https://api.example.com/posts?limit=20',
    'https://api.example.com/posts?limit=20&cursor=c2',
    'https://api.example.com/posts?limit=20&cursor=c3',
  ])
  // The items grow as each page lands; the count is saved only once it's done.
  expect(rendered.map(r => r.ids.length)).toEqual([0, 2, 4, 6])
  expect(rendered.at(-1)).toEqual({ ids: ['1', '2', '3', '4', '5', '6'], info: { loading: false, hasNext: true } })
  // A reload while it restores still finds 3: the count is never written mid-way.
  expect(writes).toEqual(['3'])
})

it('the last page ends the list: hasNext is false and next() sends nothing', async () => {
  await feed.next()
  expect(feed.state.items).toHaveLength(7)
  expect(feed.state.hasNext).toBe(false)
  const sent = mock.calls.length
  expect(await feed.next()).toBeNull()
  expect(mock.calls).toHaveLength(sent)
})
