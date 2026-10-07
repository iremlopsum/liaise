import { it, expect, afterEach } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

type User = { id: string; name: string; cartId: string }
type IncomingRequest = { headers: { cookie?: string } }

const mock = mockFetch({
  'GET /me': async ({ request }) => {
    await new Promise(r => setTimeout(r, 10))
    const who = request.headers.get('cookie') === 'session=bob' ? 'bob' : 'alice'
    return jsonResponse({ id: who, name: who, cartId: `cart-${who}` })
  },
})
mock.install()
afterEach(() => mock.restore())

// example:server-loaders:start
import { createApi, defineRequest } from 'liaise'

const me = defineRequest<User>()({ method: 'GET', path: '/me', share: true })

// One client for the whole server. Sharing compares what is actually sent,
// so one user's call never joins another's.
const api = createApi({ baseUrl: 'https://users.internal', requests: { me } })

async function renderPage(req: IncomingRequest) {
  const asUser = { headers: { cookie: req.headers.cookie ?? '' } }
  const [header, cart] = await Promise.all([
    api.me({}, asUser).then(r => r.data?.name),   // header loader
    api.me({}, asUser).then(r => r.data?.cartId), // cart loader
  ])
  return { header, cart }
}
// example:server-loaders:end

it('shares within a page view and never across users', async () => {
  const [alice, bob] = await Promise.all([
    renderPage({ headers: { cookie: 'session=alice' } }),
    renderPage({ headers: { cookie: 'session=bob' } }),
  ])
  expect(mock.callCount('GET /me')).toBe(2)
  expect(alice).toEqual({ header: 'alice', cart: 'cart-alice' })
  expect(bob).toEqual({ header: 'bob', cart: 'cart-bob' })
})
