import { it, expect } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

const mock = mockFetch({ 'POST /graphql': jsonResponse({ data: { team: { id: 't1' } } }) })
mock.install()
const events: unknown[] = []
const track = (event: unknown) => { events.push(event) }

// example:operation-type-context:start
import { createGraphQL, Operation, gql, type Middleware } from 'liaise'

// Reports every failed call with its key and whether it was a query or a
// mutation. A failed mutation may have written something; a failed query
// didn't. It never sends the variables: they can hold personal data.
const telemetry: Middleware = async (ctx, next) => {
  const result = await next()
  if (result.error && result.error.kind !== 'abort') {
    track({ operation: ctx.requestName, type: ctx.operationType, kind: result.error.kind })
  }
  return result
}

const team = new Operation<{ id: string }, { team: { id: string } }>({
  operation: gql`query Team($id: ID!) { team(id: $id) { id } }`,
})
const updateTeam = new Operation<{ id: string; name: string }, { updateTeam: { id: string } }>({
  operation: gql`mutation UpdateTeam($id: ID!, $name: String!) { updateTeam(id: $id, name: $name) { id } }`,
})

const graphql = createGraphQL({
  endpoint: 'https://api.example.com/graphql',
  middleware: [telemetry],
  queries: { team },
  mutations: { updateTeam },
})
// example:operation-type-context:end

it('tags a failed mutation as a mutation, with no variables', async () => {
  mock.restore()
  const failing = mockFetch({ 'POST /graphql': jsonResponse({ message: 'down' }, { status: 503 }) })
  failing.install()
  await graphql.mutation.updateTeam({ id: 't1', name: 'secret name' })
  await graphql.query.team({ id: 't1' })
  failing.restore()
  expect(events).toEqual([
    { operation: 'updateTeam', type: 'mutation', kind: 'http' },
    { operation: 'team', type: 'query', kind: 'http' },
  ])
  expect(JSON.stringify(events)).not.toContain('secret')
})
