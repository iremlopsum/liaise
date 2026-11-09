import { it, expect } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

// A GraphQL server with 230 orders: it answers the page the variables ask for.
const mock = mockFetch({
  'POST /graphql': ({ request }) =>
    request.json().then(({ variables }: { variables: { offset: number; limit: number } }) =>
      jsonResponse({
        data: {
          orders: {
            totalCount: 230,
            nodes: [{ id: `order-${variables.offset + 1}`, total: 10 }],
          },
        },
      })),
})
mock.install()

// example:pager-graphql:start
import { createGraphQL, Operation, gql, createPager } from 'liaise'

type Order = { id: string; total: number }
type Vars = { offset: number; limit: number }

const listOrders = new Operation<Vars, { orders: { totalCount: number; nodes: Order[] } }>({
  operation: gql`
    query ListOrders($offset: Int!, $limit: Int!) {
      orders(offset: $offset, limit: $limit) {
        totalCount
        nodes { id total }
      }
    }
  `,
})

const graphql = createGraphQL({ endpoint: 'https://api.example.com/graphql', operations: { listOrders } })

const pager = createPager(graphql.listOrders, { offset: 0, limit: 25 }, {
  toParams: (page, vars) => ({ ...vars, offset: (page - 1) * vars.limit }),
  pageCount: r => Math.ceil(r.data.orders.totalCount / 25),
})

await pager.load()
await pager.goTo(4)
// example:pager-graphql:end

mock.restore()

const variables = () => mock.calls.map(c => JSON.parse(String(c.body)).variables)

it('each move sends the operation with that page\'s variables', () => {
  expect(variables()).toEqual([
    { offset: 0, limit: 25 },
    { offset: 75, limit: 25 },
  ])
  expect(mock.calls.every(c => c.method === 'POST' && c.url === 'https://api.example.com/graphql')).toBe(true)
})

it('the state shows page 4 of 10, read from totalCount', () => {
  expect(pager.state).toMatchObject({ page: 4, pageCount: 10, hasNext: true, hasPrev: true, error: null })
  expect(pager.state.data?.orders.nodes[0]?.id).toBe('order-76')
})

it('going back to page 1 comes from the cache, with no request', async () => {
  mock.install()
  await pager.goTo(1)
  mock.restore()
  expect(variables()).toHaveLength(2)
  expect(pager.state.data?.orders.nodes[0]?.id).toBe('order-1')
})
