import { it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

let mock: ReturnType<typeof mockFetch>
beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0) }) // full jitter → no wait
afterEach(() => { mock.restore(); vi.restoreAllMocks() })

// example:retry-graphql:start
import { createGraphQL, Operation, gql } from 'liaise'
import { retryMiddleware } from 'liaise/middleware'

const team = new Operation<{ id: string }, { team: { id: string } }>({
  operation: gql`query Team($id: ID!) { team(id: $id) { id } }`,
})
// A mutation is never retried by default: a 5xx can mean the server wrote it
// and failed afterwards. This one only reads a file, so it opts in.
const parseUpload = new Operation<{ fileId: string }, { parseUpload: { rows: number } }>({
  operation: gql`mutation ParseUpload($fileId: ID!) { parseUpload(fileId: $fileId) { rows } }`,
  middleware: [retryMiddleware({ max: 2, mutations: true })],
})
const updateTeam = new Operation<{ id: string; name: string }, { updateTeam: { id: string } }>({
  operation: gql`mutation UpdateTeam($id: ID!, $name: String!) { updateTeam(id: $id, name: $name) { id } }`,
})

const graphql = createGraphQL({
  endpoint: 'https://api.example.com/graphql',
  middleware: [retryMiddleware({ max: 2 })], // retries queries; mutations pass through
  queries: { team },
  mutations: { parseUpload, updateTeam },
})
// example:retry-graphql:end

const failThenOk = (data: unknown) => [jsonResponse({}, { status: 503 }), jsonResponse({ data })]

it('retries a query', async () => {
  mock = mockFetch({ 'POST /graphql': failThenOk({ team: { id: 't1' } }) })
  mock.install()
  const { data } = await graphql.query.team({ id: 't1' })
  expect(data).toEqual({ team: { id: 't1' } })
  expect(mock.callCount('POST /graphql')).toBe(2)
})

it('sends a mutation once, and returns the 503', async () => {
  mock = mockFetch({ 'POST /graphql': failThenOk({ updateTeam: { id: 't1' } }) })
  mock.install()
  const { error } = await graphql.mutation.updateTeam({ id: 't1', name: 'A' })
  expect(error).toMatchObject({ kind: 'http', status: 503 })
  expect(mock.callCount('POST /graphql')).toBe(1)
})

it('retries the mutation that opted in, once per attempt, not once per retry middleware', async () => {
  mock = mockFetch({ 'POST /graphql': failThenOk({ parseUpload: { rows: 3 } }) })
  mock.install()
  const { data } = await graphql.mutation.parseUpload({ fileId: 'f1' })
  expect(data).toEqual({ parseUpload: { rows: 3 } })
  expect(mock.callCount('POST /graphql')).toBe(2)
})
