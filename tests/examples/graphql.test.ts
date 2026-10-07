import { it, expect, expectTypeOf, vi } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

// A GraphQL server answers with the fields the query selects, under `data`.
const category = { id: '123', name: 'Books', status: 'active' }
const mock = mockFetch({ 'POST /graphql': jsonResponse({ data: { category } }) })
mock.install()
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

// example:graphql:start
import { createGraphQL, Operation, gql } from 'liaise'

type Category = { id: string; name: string; status: string }

const GET_CATEGORY = gql`
  query GetCategory($id: String!) {
    category(id: $id) {
      id
      name
      status
    }
  }
`

// The second type is the response's data, keyed by the field the query selects.
const getCategory = new Operation<{ id: string }, { category: Category }>({
  operation: GET_CATEGORY,
})

const graphql = createGraphQL({
  endpoint: 'https://api.example.com/graphql',
  operations: { getCategory },
  onError: (error) => console.error(error.status, error.body),
})

const { data, error, response, retry } = await graphql.getCategory({ id: '123' })
// example:graphql:end

mock.restore()
consoleError.mockRestore()

it('sends a POST to the endpoint with { query, variables } as JSON', () => {
  const call = mock.lastCall('POST /graphql')!
  expect(call.method).toBe('POST')
  expect(call.url).toBe('https://api.example.com/graphql')
  expect(call.headers.get('content-type')).toBe('application/json')
  expect(JSON.parse(String(call.body))).toEqual({ query: GET_CATEGORY, variables: { id: '123' } })
})

it("data is the response's data, keyed by the query's root field", () => {
  expectTypeOf(data).toEqualTypeOf<{ category: Category } | null>()
  expect(error).toBeNull()
  expect(response?.status).toBe(200)
  expect(typeof retry).toBe('function')
  expect(data?.category.name).toBe('Books')
})
