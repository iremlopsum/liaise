import { it, expect, vi, afterAll } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

// The example's deadline is 3 seconds. Here every deadline fires 100 times sooner;
// the spy records the value liaise asked for.
const realTimeout = AbortSignal.timeout.bind(AbortSignal)
const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => realTimeout(Math.ceil(ms / 100)))
let mock = mockFetch({ 'GET /report': () => new Promise<Response>(() => {}) }) // a server that never answers
mock.install()
afterAll(() => timeoutSpy.mockRestore())

// example:deadline:start
import { createApi, defineRequest } from 'liaise'
import { retryMiddleware } from 'liaise/middleware'

type Report = { total: number }

const getReport = defineRequest<Report>()({ method: 'GET', path: '/report', timeout: 3000 })

const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getReport },
  middleware: [retryMiddleware(3)],
  timeout: 10_000, // for every endpoint that sets none
})

const { error } = await api.getReport()
// If no answer arrives within 3 seconds, retries included: error.kind === 'timeout', error.status === 0
// example:deadline:end

mock.restore()

it("a hung call ends with kind 'timeout' at the endpoint's 3 second deadline", () => {
  expect(timeoutSpy).toHaveBeenCalledWith(3000) // the endpoint's, not the client's 10_000
  expect(error?.kind).toBe('timeout')
  expect(error?.status).toBe(0)
  expect(mock.callCount('GET /report')).toBe(1)
})

it('the deadline also covers the waits between retries', async () => {
  // Every attempt gets a 503, so retryMiddleware waits before trying again. The 3 second
  // deadline (30 ms here) passes during the first wait, which stays at its real length.
  vi.spyOn(Math, 'random').mockReturnValue(0.5) // jitter: the first wait is 125 ms
  let served = 0
  mock = mockFetch({ 'GET /report': () => { served++; return jsonResponse({ message: 'busy' }, { status: 503 }) } })
  mock.install()
  const result = await api.getReport()
  mock.restore()
  vi.mocked(Math.random).mockRestore()
  expect(result.error?.kind).toBe('timeout') // not the 503 that caused the retry
  // The retry after the wait goes to fetch with the deadline's signal already aborted, so the
  // stub records it (as real fetch would see it) but no server answers it.
  expect(served).toBe(1)
})
