import { describe, it, expect, expectTypeOf, afterEach } from 'vitest'
import { mockFetch, jsonResponse, type RouteValue } from 'liaise/testing'
import { createGraphQL, Operation, gql } from 'liaise'

let mock = mockFetch({ 'GET /users/:id': jsonResponse({ id: '42', name: 'Ada' }) })
mock.install()

// example:validating-responses:start
import { createApi, defineRequest } from 'liaise'
import { z } from 'zod'

const getUser = defineRequest()({
  method: 'GET',
  path: '/users/:id',
  schema: z.object({ id: z.string(), name: z.string() }),
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { getUser } })

const { data, error } = await api.getUser({ id: '42' })
//      ^? { id: string; name: string } | null
// example:validating-responses:end

mock.restore()

const serve = (route: RouteValue) => {
  mock = mockFetch({ 'GET /users/:id': route })
  mock.install()
}
afterEach(() => mock.restore())

describe('a schema on an endpoint', () => {
  it('passes a body that matches, typed by the schema', () => {
    expectTypeOf(data).toEqualTypeOf<{ id: string; name: string } | null>()
    expect(error).toBeNull()
    expect(data).toEqual({ id: '42', name: 'Ada' })
  })

  it("turns a bad shape into kind 'parse', with the validator's issues and the response's own status", async () => {
    serve(jsonResponse({ id: 42, name: 'Ada' })) // the backend changed id to a number
    const result = await api.getUser({ id: '42' })
    expect(result.data).toBeNull()
    expect(result.error?.kind).toBe('parse')
    expect(result.error?.status).toBe(200)
    expect(result.error?.body).toEqual([expect.objectContaining({ path: ['id'] })])
  })

  it('leaves a non-2xx body alone', async () => {
    serve(jsonResponse({ message: 'no such user' }, { status: 404 }))
    const result = await api.getUser({ id: '42' })
    expect(result.error?.kind).toBe('http')
    expect(result.error?.body).toEqual({ message: 'no such user' })
  })
})

describe("an Operation's schema", () => {
  const server = () => {
    mock = mockFetch({ 'POST /graphql': jsonResponse({ data: { me: { id: '1', name: 'Ada' } } }) })
    mock.install()
  }
  const UserSchema = z.object({ id: z.string(), name: z.string() })

  it("checks the response's whole data object, root field included", async () => {
    server()
    const MeSchema = z.object({ me: UserSchema })
    const me = new Operation<Record<string, never>, z.infer<typeof MeSchema>>({
      operation: gql`query { me { id name } }`,
      schema: MeSchema,
    })
    const graphql = createGraphQL({ endpoint: 'https://api.example.com/graphql', operations: { me } })
    const result = await graphql.me()
    expect(result.error).toBeNull()
    expect(result.data).toEqual({ me: { id: '1', name: 'Ada' } })
  })

  it("so a schema for the inner object alone refuses the response with kind 'parse'", async () => {
    server()
    const me = new Operation<Record<string, never>, z.infer<typeof UserSchema>>({
      operation: gql`query { me { id name } }`,
      schema: UserSchema,
    })
    const graphql = createGraphQL({ endpoint: 'https://api.example.com/graphql', operations: { me } })
    const result = await graphql.me()
    expect(result.error?.kind).toBe('parse')
  })
})
