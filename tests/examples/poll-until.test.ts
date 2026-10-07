import { it, expect, vi, afterAll } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

vi.useFakeTimers()
const answers: Record<string, string[]> = { e1: ['queued', 'queued', 'done'], stuck: ['queued'] }
const asked: Record<string, number> = {}
const mock = mockFetch({ 'GET /exports/:id': ({ params }) => {
  const list = answers[params.id]
  if (!list) return jsonResponse({ message: 'No such export' }, { status: 404 })
  const n = (asked[params.id] = (asked[params.id] ?? 0) + 1)
  const status = list[Math.min(n, list.length) - 1]
  return jsonResponse(status === 'done' ? { id: params.id, status, url: `https://files.example.com/${params.id}.csv` } : { id: params.id, status })
} })
mock.install()
const lines: string[] = []
const download = (url: string) => lines.push(`download ${url}`)
const showError = (kind: string) => lines.push(`error ${kind}`)

// example:poll-until:start
import { createApi, defineRequest, pollUntil } from 'liaise'

type Export = { id: string; status: 'queued' | 'running' | 'done'; url?: string }

const getExport = defineRequest<Export>()({ method: 'GET', path: '/exports/:id' })
const api = createApi({ baseUrl: 'https://api.example.com', requests: { getExport } })

async function waitForExport(id: string) {
  // Ask every 2 seconds until the export is done; give up after a minute.
  const { data, error } = await pollUntil(api.getExport, { id }, {
    every: 2000,
    until: r => r.data.status === 'done',
    giveUpAfter: 60_000,
  })
  if (error) return showError(error.kind)
  download(data.url!)
}
// example:poll-until:end

afterAll(() => { mock.restore(); vi.useRealTimers() })

it('asks until the export is done: three requests, then the download', async () => {
  const run = waitForExport('e1')
  await vi.advanceTimersByTimeAsync(4000)
  await run
  expect(lines).toEqual(['download https://files.example.com/e1.csv'])
  expect(asked.e1).toBe(3)
})

it('gives up with a timeout after a minute', async () => {
  lines.length = 0
  const run = waitForExport('stuck')
  await vi.advanceTimersByTimeAsync(60_000)
  await run
  expect(lines).toEqual(['error timeout'])
})

it('stops at once on a 404', async () => {
  lines.length = 0
  await waitForExport('missing')
  expect(lines).toEqual(['error http'])
})
