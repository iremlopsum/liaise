import { it, expect, vi } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

const mock = mockFetch({ 'POST /graphql': jsonResponse({ message: 'down' }, { status: 503 }) })
mock.install()
const reports: unknown[] = []
const report = (event: unknown) => { reports.push(event) }

// example:error-request-name:start
import { createGraphQL, Operation, gql } from 'liaise'

const createPayment = new Operation<{ cardToken: string; amount: number }, { createPayment: { id: string } }>({
  operation: gql`mutation CreatePayment($cardToken: String!, $amount: Int!) { createPayment(cardToken: $cardToken, amount: $amount) { id } }`,
})

const graphql = createGraphQL({
  endpoint: 'https://api.example.com/graphql',
  mutations: { createPayment },
  // Which call failed, and whether it was a write, without the variables:
  // error.request.params holds the card token, so it is never sent.
  onError: (error) => report({
    operation: error.request.name,
    type: error.request.operationType,
    kind: error.kind,
    status: error.status,
  }),
})
// example:error-request-name:end

it('reports the key and type, and nothing from the variables', async () => {
  await graphql.mutation.createPayment({ cardToken: 'tok_secret', amount: 500 })
  mock.restore()
  expect(reports).toEqual([{ operation: 'createPayment', type: 'mutation', kind: 'http', status: 503 }])
  expect(JSON.stringify(reports)).not.toContain('tok_secret')
})
