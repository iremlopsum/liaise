import { it, expect, afterEach } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

type User = { id: string; name: string }
const mock = mockFetch({
  'GET /api/me': async () => {
    await new Promise(r => setTimeout(r, 10))
    return jsonResponse({ id: '1', name: 'Ada' })
  },
})
mock.install()
afterEach(() => mock.restore())

// readme:store-me:start
import { createApi, defineRequest } from 'liaise'

const me = defineRequest<User>()({ method: 'GET', path: '/me', share: true })
const api = createApi({ baseUrl: '/api', requests: { me } })

// Any store works the same way: Zustand, Pinia, Redux or a plain object.
const store = { user: null as User | null }

async function loadUser() {
  if (store.user) return // empty on first render, for every component
  const { data } = await api.me() // callers at the same moment join one request
  if (data) store.user = data
}
// readme:store-me:end

it('three components loading at once make one request', async () => {
  await Promise.all([loadUser(), loadUser(), loadUser()])
  expect(mock.callCount('GET /api/me')).toBe(1)
  expect(store.user).toEqual({ id: '1', name: 'Ada' })
})
