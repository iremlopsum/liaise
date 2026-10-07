import { describe, it, expect, afterEach } from 'vitest'
import { mockFetch, jsonResponse, type RouteValue } from 'liaise/testing'

// example:reading-responses:start
import { createApi, defineRequest } from 'liaise'

type User = { id: string; name: string }

// JSON is the default.
const getUser = defineRequest<User>()({ method: 'GET', path: '/users/:id' })

// A CSV export comes back as a string.
const exportCsv = defineRequest<string>()({ method: 'GET', path: '/reports/:id/csv', responseType: 'text' })

// A file comes back as a Blob.
const downloadFile = defineRequest<Blob>()({ method: 'GET', path: '/files/:id', responseType: 'blob' })

// A 204 No Content has no body, so data is undefined.
const deleteUser = defineRequest<undefined>()({
  method: 'DELETE',
  path: '/users/:id',
  responseType: 'none',
})

const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUser, exportCsv, downloadFile, deleteUser },
})
// example:reading-responses:end

let mock: ReturnType<typeof mockFetch>
const serve = (routes: Record<string, RouteValue>) => {
  mock = mockFetch(routes)
  mock.install()
}
afterEach(() => mock.restore())

describe('each responseType', () => {
  it("'json' (the default) parses the body", async () => {
    serve({ 'GET /users/:id': jsonResponse({ id: '42', name: 'Ada' }) })
    const { data, error } = await api.getUser({ id: '42' })
    expect(error).toBeNull()
    expect(data).toEqual({ id: '42', name: 'Ada' })
  })

  it("'text' gives the body as a string", async () => {
    serve({ 'GET /reports/:id/csv': new Response('name,total\nAda,3\n', { headers: { 'content-type': 'text/csv' } }) })
    const { data } = await api.exportCsv({ id: '7' })
    expect(data).toBe('name,total\nAda,3\n')
  })

  it("'blob' gives a Blob", async () => {
    serve({ 'GET /files/:id': new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'application/octet-stream' } }) })
    const { data } = await api.downloadFile({ id: '7' })
    expect(data).toBeInstanceOf(Blob)
    expect(new Uint8Array(await data!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it("'none' succeeds on a 204 with data undefined", async () => {
    serve({ 'DELETE /users/:id': new Response(null, { status: 204 }) })
    const result = await api.deleteUser({ id: '42' })
    expect(result.error).toBeNull()
    expect(result.data).toBeUndefined()
  })

  it("'none' discards a body the server sends anyway", async () => {
    // A route function, so the call gets a fresh Response as from a real server. A static
    // route value is served as a clone, and a clone's cancelled body never settles while the
    // original stays unread, so 'none' would hang here (reported; src/ is out of scope).
    serve({ 'DELETE /users/:id': () => jsonResponse({ deleted: true }) })
    const result = await api.deleteUser({ id: '42' })
    expect(result.error).toBeNull()
    expect(result.data).toBeUndefined()
  })
})

describe('the rules under the table', () => {
  it("an empty body under 'json' is a 'parse' error with the response's own status", async () => {
    serve({ 'GET /users/:id': new Response(null, { status: 204 }) })
    const { error } = await api.getUser({ id: '42' })
    expect(error?.kind).toBe('parse')
    expect(error?.status).toBe(204)
    expect(error?.body).toBe('')
  })

  it('a literal null body is valid JSON, so the call succeeds with data null', async () => {
    serve({ 'GET /users/:id': new Response('null', { headers: { 'content-type': 'application/json' } }) })
    const { data, error } = await api.getUser({ id: '42' })
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it("a non-2xx body is read as JSON into error.body, even under 'none'", async () => {
    serve({ 'DELETE /users/:id': jsonResponse({ error: 'already deleted' }, { status: 409 }) })
    const { error } = await api.deleteUser({ id: '42' })
    expect(error?.status).toBe(409)
    expect(error?.body).toEqual({ error: 'already deleted' })
  })

  it("under 'none', a non-2xx body that isn't JSON gives error.body null", async () => {
    serve({ 'DELETE /users/:id': new Response('Conflict', { status: 409 }) })
    const { error } = await api.deleteUser({ id: '42' })
    expect(error?.status).toBe(409)
    expect(error?.body).toBeNull()
  })
})
