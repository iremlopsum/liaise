import { it, expect, afterEach, beforeEach } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'
import { createApi, defineRequest } from 'liaise'

type User = { id: string; name: string }
const api = createApi({
  baseUrl: '/api',
  requests: { getUser: defineRequest<User>()({ method: 'GET', path: '/users/:id' }) },
})

// Minimal stand-ins with React's shape. Enough to run the hook body once.
let state: unknown
let cleanup: (() => void) | undefined
function useState<T>(initial: T): [T, (v: T) => void] {
  if (state === undefined) state = initial
  return [state as T, v => { state = v }]
}
function useEffect(effect: () => void | (() => void), _deps: unknown[]) {
  cleanup = effect() ?? undefined
}

let release!: () => void
const mock = mockFetch({
  'GET /api/users/:id': ({ params }) =>
    new Promise(resolve => { release = () => resolve(jsonResponse({ id: params.id, name: 'Ada' })) }),
})
beforeEach(() => mock.install())
afterEach(() => { mock.restore(); state = undefined })

// example:react-effect:start
function useUser(id: string) {
  const [state, setState] = useState<{ user?: User; failed?: boolean }>({})

  useEffect(() => {
    const controller = new AbortController()
    api.getUser({ id }, { signal: controller.signal }).then(({ data, error }) => {
      if (error?.kind === 'abort') return // unmounted, or id changed
      setState(error ? { failed: true } : { user: data })
    })
    return () => controller.abort() // cancel when the component goes away
  }, [id])

  return state
}
// example:react-effect:end

const tick = () => new Promise(r => setTimeout(r, 0))

it('stores the user when the call succeeds', async () => {
  useUser('42')
  await tick()
  release()
  await tick()
  expect(state).toEqual({ user: { id: '42', name: 'Ada' } })
})

it('leaves state alone when the component unmounts first', async () => {
  useUser('42')
  await tick()
  cleanup!()
  await tick()
  expect(state).toEqual({})
})
