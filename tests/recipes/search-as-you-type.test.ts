import { it, expect, afterEach, vi } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

type Repo = { name: string }
const rendered: Repo[][] = []
const render = (repos: Repo[]) => { rendered.push(repos) }
const showError = vi.fn()

// Short queries are slow, so without dedupe the stale "r" result lands last.
const delay: Record<string, number> = { r: 60, re: 30, rea: 5 }
const mock = mockFetch({
  'GET /api/search': async ({ request }) => {
    const q = new URL(request.url, 'http://x').searchParams.get('q')!
    await new Promise(r => setTimeout(r, delay[q]))
    return jsonResponse([{ name: `results for ${q}` }])
  },
})
mock.install()
afterEach(() => mock.restore())

// readme:search-as-you-type:start
import { createApi, defineRequest } from 'liaise'

const search = defineRequest<Repo[], { q: string }>()({
  method: 'GET',
  path: '/search',
  dedupe: true, // a new call cancels the one still in flight
})
const api = createApi({ baseUrl: '/api', requests: { search } })

async function onInput(q: string) {
  const { data, error } = await api.search({ q })
  if (error?.kind === 'abort') return // a newer search replaced this one
  if (error) return showError(error)
  render(data)
}
// readme:search-as-you-type:end

it('shows only the latest search, even when an older one answers last', async () => {
  await Promise.all([onInput('r'), onInput('re'), onInput('rea')])
  expect(rendered).toEqual([[{ name: 'results for rea' }]])
  expect(showError).not.toHaveBeenCalled()
})
