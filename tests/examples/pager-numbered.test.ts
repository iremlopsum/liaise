import { it, expect, vi, afterAll } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

// The reader's own UI code, which the example only calls.
type Info = { page: number | null; pageCount: number | null; loading: boolean; error: unknown }
const rendered: { first: string | undefined; info: Info }[] = []
const render = (items: { id: string }[], info: Info) => { rendered.push({ first: items[0]?.id, info }) }

// The address the reader opened: page 2 of the orders.
const replaceState = vi.fn<(data: unknown, unused: string, url: string) => void>()
vi.stubGlobal('location', { search: '?page=2' })
vi.stubGlobal('history', { replaceState })

// 230 orders. Each request waits until the test answers it, so a test can click while one is in flight.
const waiting: (() => void)[] = []
const answerAll = () => waiting.splice(0).forEach(answer => answer())
const mock = mockFetch({
  'GET /orders': ({ request }) => {
    const offset = Number(new URL(request.url).searchParams.get('offset'))
    const items = [{ id: `order-${offset + 1}`, total: 10 }]
    return new Promise(resolve => waiting.push(() => resolve(jsonResponse({ items, totalCount: 230 }))))
  },
})
mock.install()
afterAll(() => { mock.restore(); vi.unstubAllGlobals() })

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const urls = () => mock.calls.map(c => c.url)

// example:pager-numbered:start
import { createApi, defineRequest, createPager } from 'liaise'

type Order = { id: string; total: number }
type Page = { items: Order[]; totalCount: number }
type Params = { offset: number; limit: number; q?: string }

const listOrders = defineRequest<Page, Params>()({ method: 'GET', path: '/orders' })
const api = createApi({ baseUrl: 'https://api.example.com', requests: { listOrders } })

const limit = 25
// Typed as Params, so setParams can add the filter the first request doesn't send.
const unfiltered: Params = { offset: 0, limit }

const pager = createPager(api.listOrders, unfiltered, {
  toParams: (page, params) => ({ ...params, offset: (page - 1) * limit }),
  pageCount: r => Math.ceil(r.data.totalCount / limit),
  // The page in the address, so a reload or a shared link opens the same page.
  start: Number(new URLSearchParams(location.search).get('page') ?? 1),
})

pager.subscribe(() => {
  const { data, page, pageCount, loading, error } = pager.state
  render(data?.items ?? [], { page, pageCount, loading, error })
  if (page !== null) history.replaceState(null, '', `?page=${page}`)
})

pager.load()
// Your page buttons call pager.goTo(n), and Previous and Next call pager.prev() and pager.next().

function onFilter(q: string) {
  pager.setParams({ offset: 0, limit, q }) // back to page 1, with the new filter
}
// example:pager-numbered:end

it('load() opens the page in the address', async () => {
  expect(urls()).toEqual(['https://api.example.com/orders?offset=25&limit=25'])
  expect(rendered.at(-1)!.info).toEqual({ page: null, pageCount: null, loading: true, error: null })
  answerAll()
  await tick()
  expect(rendered.at(-1)).toEqual({ first: 'order-26', info: { page: 2, pageCount: 10, loading: false, error: null } })
  expect(replaceState).toHaveBeenLastCalledWith(null, '', '?page=2')
})

it('goTo(3) asks for offset 50, and page 2 stays on screen while it loads', async () => {
  rendered.length = 0
  const to3 = pager.goTo(3)
  await tick()
  expect(urls().at(-1)).toBe('https://api.example.com/orders?offset=50&limit=25')
  expect(rendered).toEqual([{ first: 'order-26', info: { page: 2, pageCount: 10, loading: true, error: null } }])
  // The reader clicks on: 5, then 4, each before the page before it arrived.
  const to5 = pager.goTo(5)
  await tick()
  const to4 = pager.goTo(4)
  await tick()
  expect(urls().slice(-3)).toEqual([
    'https://api.example.com/orders?offset=50&limit=25',
    'https://api.example.com/orders?offset=100&limit=25',
    'https://api.example.com/orders?offset=75&limit=25',
  ])
  answerAll() // too late for pages 3 and 5: their requests were cancelled
  expect((await to3)?.error?.kind).toBe('abort')
  expect((await to5)?.error?.kind).toBe('abort')
  expect((await to4)?.error).toBeNull()
  await tick()
  // 3 → 5 → 4 renders only page 4: page 2 stays on screen until then.
  expect(rendered.map(r => r.first)).toEqual(['order-26', 'order-26', 'order-26', 'order-76'])
  expect(rendered.at(-1)!.info).toEqual({ page: 4, pageCount: 10, loading: false, error: null })
  expect(replaceState).toHaveBeenLastCalledWith(null, '', '?page=4')
})

it('a filter change goes back to page 1 with the filter in the params', async () => {
  onFilter('acme')
  await tick()
  expect(urls().at(-1)).toBe('https://api.example.com/orders?offset=0&limit=25&q=acme')
  answerAll()
  await tick()
  expect(rendered.at(-1)).toEqual({ first: 'order-1', info: { page: 1, pageCount: 10, loading: false, error: null } })
  expect(replaceState).toHaveBeenLastCalledWith(null, '', '?page=1')
})
