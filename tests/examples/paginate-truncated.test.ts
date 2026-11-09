import { it, expect, vi } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

// The reader's own code, which the example only calls.
const exported: unknown[] = []
const save = (items: unknown[]) => { exported.push(...items) }
const warn = vi.fn<(message: string) => void>()

// Three pages of 1,000 rows. The last one has no cursor.
const row = (id: number) => ({ id: String(id) })
const serverPages: Record<string, { items: { id: string }[]; cursor?: string }> = {
  start: { items: Array.from({ length: 1000 }, (_, i) => row(i)), cursor: 'c2' },
  c2: { items: Array.from({ length: 1000 }, (_, i) => row(1000 + i)), cursor: 'c3' },
  c3: { items: Array.from({ length: 1000 }, (_, i) => row(2000 + i)) },
}
const mock = mockFetch({
  'GET /rows': ({ request }) => jsonResponse(serverPages[new URL(request.url).searchParams.get('cursor') ?? 'start']),
})
mock.install()

// example:paginate-truncated:start
import { createApi, defineRequest, paginate } from 'liaise'

type Row = { id: string }
type Page = { items: Row[]; cursor?: string }

const listRows = defineRequest<Page, { limit: number; cursor?: string }>()({
  method: 'GET',
  path: '/rows',
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { listRows } })

const pages = paginate(api.listRows, { limit: 1000 }, {
  next: (p, prev) => (p.data.cursor ? { ...prev, cursor: p.data.cursor } : undefined),
  maxPages: 2,
})

for await (const page of pages) {
  if (page.error) break
  save(page.data.items)
}
if (pages.truncated) warn('Export cut at 2,000 rows')
// example:paginate-truncated:end

mock.restore()

it('stops after two pages, with the cursor from the first', () => {
  expect(mock.calls.map(c => c.url)).toEqual([
    'https://api.example.com/rows?limit=1000',
    'https://api.example.com/rows?limit=1000&cursor=c2',
  ])
  expect(exported).toHaveLength(2000)
})

it('warns once, because a third page existed', () => {
  expect(warn).toHaveBeenCalledTimes(1)
  expect(warn).toHaveBeenCalledWith('Export cut at 2,000 rows')
})

it('reading truncated sent no request', () => {
  expect(mock.calls).toHaveLength(2)
})
