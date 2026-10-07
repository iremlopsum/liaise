import { it, expect, vi, afterAll } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

vi.useFakeTimers()
let unread = 0
const mock = mockFetch({ 'GET /notifications/count': () => jsonResponse({ unread: ++unread }) })
mock.install()
const shown: number[] = []
const setCount = (n: number) => shown.push(n)
let offline = 0
const showOffline = () => offline++

// example:poll:start
import { createApi, defineRequest, poll } from 'liaise'

const getUnread = defineRequest<{ unread: number }>()({ method: 'GET', path: '/notifications/count' })
const api = createApi({ baseUrl: 'https://api.example.com', requests: { getUnread } })

// Ask now, then 5 seconds after each answer, until you call stop().
const stop = poll(api.getUnread, {}, ({ data, error }) => {
  if (error) showOffline()
  else setCount(data.unread)
}, { every: 5000 })
// example:poll:end

afterAll(() => { mock.restore(); vi.useRealTimers() })

it('asks at once, then every 5 seconds, and stop() ends it', async () => {
  await vi.advanceTimersByTimeAsync(10_000)
  expect(shown).toEqual([1, 2, 3])
  stop()
  await vi.advanceTimersByTimeAsync(20_000)
  expect(shown).toEqual([1, 2, 3])
  expect(offline).toBe(0)
})
