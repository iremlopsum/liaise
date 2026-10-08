import { it, expect, afterEach } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'
import { createApi } from 'liaise'
import { retryMiddleware } from 'liaise/middleware'

const mock = mockFetch({
  'PATCH /users/:id': jsonResponse({ id: '7', name: 'Grace' }),
})
mock.install()
afterEach(() => { mock.calls.length = 0 })

// example:query-with-body:start
import { defineRequest } from 'liaise'
import type { Middleware } from 'liaise'

// Moves the named params from the JSON body to the query string.
const inQuery = (...names: string[]): Middleware => (ctx, next) => {
  const { body, headers } = ctx.request
  if (typeof body === 'string' && headers.get('content-type') === 'application/json') {
    const fields = JSON.parse(body) as Record<string, unknown>
    const url = new URL(ctx.request.url)
    for (const name of names) {
      const value = fields[name]
      delete fields[name]
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined && item !== null) url.searchParams.append(name, String(item))
      }
    }
    ctx.request.url = url.toString()
    ctx.request.body = JSON.stringify(fields)
  }
  return next()
}

type User = { id: string; name: string; email: string }

const updateUser = defineRequest<User, { name?: string; email?: string; updateMask: string[] }>()({
  method: 'PATCH',
  path: '/users/:id',
  middleware: [inQuery('updateMask')],
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { updateUser } })

await api.updateUser({ id: '7', name: 'Grace', updateMask: ['name'] })
// PATCH /users/7?updateMask=name, with the JSON body {"name":"Grace"}
// example:query-with-body:end

const [exampleCall] = mock.calls

it('moves the named param to the query string and leaves the rest in the body', () => {
  expect(exampleCall.method).toBe('PATCH')
  expect(exampleCall.url).toBe('https://api.example.com/users/7?updateMask=name')
  expect(exampleCall.body).toBe('{"name":"Grace"}')
  expect(exampleCall.headers.get('content-type')).toBe('application/json')
})

it('sends an array as repeated keys, as liaise does in a query string', async () => {
  await api.updateUser({ id: '7', name: 'Grace', email: 'g@example.com', updateMask: ['name', 'email'] })
  const [call] = mock.calls
  expect(call.url).toBe('https://api.example.com/users/7?updateMask=name&updateMask=email')
  expect(call.body).toBe('{"name":"Grace","email":"g@example.com"}')
})

it('adds the param once when retryMiddleware sends the request again', async () => {
  let attempts = 0
  const flaky = mockFetch({
    'PATCH /users/:id': () => (++attempts === 1 ? jsonResponse({}, { status: 503 }) : jsonResponse({ id: '7', name: 'Grace' })),
  })
  mock.restore()
  flaky.install()
  try {
    const retrying = createApi({
      baseUrl: 'https://api.example.com',
      requests: { updateUser },
      middleware: [retryMiddleware({ max: 1, baseDelay: 0 })],
    })
    const { error } = await retrying.updateUser({ id: '7', name: 'Grace', updateMask: ['name'] })
    expect(error).toBeNull()
    expect(flaky.calls.map(c => c.url)).toEqual([
      'https://api.example.com/users/7?updateMask=name',
      'https://api.example.com/users/7?updateMask=name',
    ])
    expect(flaky.calls[1].body).toBe('{"name":"Grace"}')
  } finally {
    flaky.restore()
    mock.install()
  }
})

it('leaves a JSON array body alone', async () => {
  const local = mockFetch({ 'POST /users/bulk': jsonResponse({ created: 1 }, { status: 201 }) })
  mock.restore()
  local.install()
  try {
    const bulk = defineRequest<{ created: number }, { name: string; updateMask?: string }[]>()({
      method: 'POST',
      path: '/users/bulk',
      middleware: [inQuery('updateMask')],
    })
    const client = createApi({ baseUrl: 'https://api.example.com', requests: { bulk } })
    const { error } = await client.bulk([{ name: 'Grace', updateMask: 'name' }])
    expect(error).toBeNull()
    expect(local.calls[0].url).toBe('https://api.example.com/users/bulk')
    expect(local.calls[0].body).toBe('[{"name":"Grace","updateMask":"name"}]')
  } finally {
    local.restore()
    mock.install()
  }
})
