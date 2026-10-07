import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockFetch, jsonResponse, type RouteValue } from 'liaise/testing'

let shown: string[] = []
const show = (message: string) => { shown.push(message) }
const redirectToLogin = vi.fn()
const report = vi.fn()

// example:handling-errors:start
import { createApi, defineRequest } from 'liaise'

type User = { id: string; name: string }

const getUser = defineRequest<User>()({ method: 'GET', path: '/users/:id', timeout: 5000 })
const api = createApi({ baseUrl: 'https://api.example.com', requests: { getUser } })

async function loadUser(id: string) {
  const { data, error } = await api.getUser({ id })

  if (error) {
    switch (error.kind) {
      case 'http':       // the server answered with a non-2xx status
        if (error.status === 401) redirectToLogin()
        else show(`The server said no (${error.status})`)
        break
      case 'network':    // no response arrived
        show("You're offline. Try again.")
        break
      case 'timeout':    // the 5 second deadline passed
        show('This is taking too long.')
        break
      case 'abort':      // you cancelled the call, so there is nothing to show
        break
      case 'parse':      // a 2xx body that didn't parse or failed the schema
      case 'middleware': // your own middleware threw
        report(error)
        break
    }
    return
  }

  show(`Hello, ${data.name}`) // data is a User here
}
// example:handling-errors:end

describe('each error kind reaches its branch', () => {
  let mock: ReturnType<typeof mockFetch>
  const serve = (route: RouteValue) => {
    mock = mockFetch({ 'GET /users/:id': route })
    mock.install()
  }
  const realTimeout = AbortSignal.timeout.bind(AbortSignal)
  beforeEach(() => {
    shown = []
    redirectToLogin.mockClear()
    report.mockClear()
    // The example's deadline is 5 seconds. Here it fires 100 times sooner.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => realTimeout(Math.ceil(ms / 100)))
  })
  afterEach(() => { mock.restore(); vi.restoreAllMocks() })

  it('success: data is a User', async () => {
    serve(({ params }) => jsonResponse({ id: params.id, name: 'Ada' }))
    await loadUser('42')
    expect(shown).toEqual(['Hello, Ada'])
  })
  it("'http' 401: redirects to login", async () => {
    serve(jsonResponse({ message: 'signed out' }, { status: 401 }))
    await loadUser('42')
    expect(redirectToLogin).toHaveBeenCalledTimes(1)
    expect(shown).toEqual([])
  })
  it("'http' 500: shows the status", async () => {
    serve(jsonResponse({ message: 'boom' }, { status: 500 }))
    await loadUser('42')
    expect(shown).toEqual(['The server said no (500)'])
  })
  it("'network': fetch itself failed", async () => {
    serve(() => { throw new TypeError('fetch failed') })
    await loadUser('42')
    expect(shown).toEqual(["You're offline. Try again."])
  })
  it("'timeout': the server never answers", async () => {
    serve(() => new Promise<Response>(() => {}))
    await loadUser('42')
    expect(AbortSignal.timeout).toHaveBeenCalledWith(5000)
    expect(shown).toEqual(['This is taking too long.'])
  })
  it("'parse': a 2xx body that isn't JSON is reported", async () => {
    serve(new Response('<html>', { status: 200, headers: { 'content-type': 'application/json' } }))
    await loadUser('42')
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0][0]).toMatchObject({ kind: 'parse', status: 200 })
    expect(shown).toEqual([])
  })
})
