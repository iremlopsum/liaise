import { it, expect, vi, afterAll } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

// The reader's own UI code, which the example only calls.
type Info = { page: number | null; hasPrev: boolean; hasNext: boolean; loading: boolean }
const rendered: { first: string | undefined; info: Info }[] = []
const render = (items: { id: string }[], info: Info) => { rendered.push({ first: items[0]?.id, info }) }

// The reader reloaded on the second page, so its cursor is in the address.
const replaceState = vi.fn<(data: unknown, unused: string, url: string) => void>()
vi.stubGlobal('location', { search: '?cursor=c2', pathname: '/items' })
vi.stubGlobal('history', { replaceState })

// Three pages. The last one has no next cursor.
const serverPages: Record<string, { items: { id: string; name: string }[]; next: string | null }> = {
  start: { items: [{ id: '1', name: 'a' }], next: 'c2' },
  c2: { items: [{ id: '2', name: 'b' }], next: 'c3' },
  c3: { items: [{ id: '3', name: 'c' }], next: null },
}
const mock = mockFetch({
  'GET /items': ({ request }) => jsonResponse(serverPages[new URL(request.url).searchParams.get('cursor') ?? 'start']),
})
mock.install()
afterAll(() => { mock.restore(); vi.unstubAllGlobals() })

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const urls = () => mock.calls.map(c => c.url)

// example:pager-cursor:start
import { createApi, defineRequest, createPager } from 'liaise'

type Item = { id: string; name: string }
type Page = { items: Item[]; next: string | null }
type Params = { limit: number; cursor?: string }

const listItems = defineRequest<Page, Params>()({ method: 'GET', path: '/items' })
const api = createApi({ baseUrl: 'https://api.example.com', requests: { listItems } })

// A cursor in the address opens that page, after a reload or from a shared link.
const cursor = new URLSearchParams(location.search).get('cursor')

const pager = createPager(api.listItems, { limit: 50 }, {
  next: (r, params) => (r.data.next ? { ...params, cursor: r.data.next } : undefined),
  from: cursor ? { limit: 50, cursor } : undefined,
})

pager.subscribe(() => {
  const { data, params, page, hasPrev, hasNext, loading } = pager.state
  render(data?.items ?? [], { page, hasPrev, hasNext, loading })
  if (params) history.replaceState(null, '', params.cursor ? `?cursor=${params.cursor}` : location.pathname)
})

pager.load()
// Your Previous and Next buttons call pager.prev() and pager.next().

function firstPage() {
  pager.setParams({ limit: 50 }) // the first page, wherever the pager opened
}
// example:pager-cursor:end

it('load() opens the page the cursor in the address names; there is no page before it yet', async () => {
  await tick()
  expect(urls()).toEqual(['https://api.example.com/items?limit=50&cursor=c2'])
  expect(rendered.at(-1)).toEqual({ first: '2', info: { page: null, hasPrev: false, hasNext: true, loading: false } })
  expect(replaceState).toHaveBeenLastCalledWith(null, '', '?cursor=c2')
})

it('Next asks with the cursor the page named, and writes it to the address', async () => {
  await pager.next()
  expect(urls().at(-1)).toBe('https://api.example.com/items?limit=50&cursor=c3')
  expect(rendered.at(-1)).toEqual({ first: '3', info: { page: null, hasPrev: true, hasNext: false, loading: false } })
  expect(replaceState).toHaveBeenLastCalledWith(null, '', '?cursor=c3')
})

it('Previous goes back to the page already seen, without a request; Next is then the remembered page', async () => {
  await pager.prev()
  expect(urls()).toHaveLength(2)
  expect(rendered.at(-1)).toEqual({ first: '2', info: { page: null, hasPrev: false, hasNext: true, loading: false } })
  expect(replaceState).toHaveBeenLastCalledWith(null, '', '?cursor=c2')
  expect(await pager.prev()).toBeNull() // nothing before the page it opened at
  expect(urls()).toHaveLength(2)
})

it('firstPage() asks for the first page, which is page 1, and drops the cursor from the address', async () => {
  firstPage()
  await tick()
  expect(urls().at(-1)).toBe('https://api.example.com/items?limit=50')
  expect(rendered.at(-1)).toEqual({ first: '1', info: { page: 1, hasPrev: false, hasNext: true, loading: false } })
  expect(replaceState).toHaveBeenLastCalledWith(null, '', '/items')
  await pager.next()
  expect(urls().at(-1)).toBe('https://api.example.com/items?limit=50&cursor=c2')
  expect(rendered.at(-1)).toEqual({ first: '2', info: { page: 2, hasPrev: true, hasNext: true, loading: false } })
})
