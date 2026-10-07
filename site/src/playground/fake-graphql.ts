// POST /graphql for the fake API: real GraphQL execution (graphql-js) over the same people as
// GET /users/:id, so a visitor's own query or mutation is parsed, validated and run for real.
// graphql-js is imported on the first /graphql request, so a page or run that never calls
// GraphQL never loads it.
//
// The REST fake's failure ids work here too: a user id of '500' answers HTTP 500, 'offline'
// fails the network and 'slow' never answers. Any other unknown id resolves to null with a
// "User not found" error, which is GraphQL's own partial-data answer.
import type { GraphQLSchema, graphql as Execute } from 'graphql'
import type { Person, Route } from './fake-server'

export const SDL = /* GraphQL */ `
  type Post { id: ID!, title: String! }
  type User { id: ID!, name: String!, email: String!, posts: [Post!]! }
  type Query { user(id: ID!): User, users: [User!]! }
  type Mutation { renameUser(id: ID!, name: String!): User }
`

let engine: Promise<{ graphql: typeof Execute; schema: GraphQLSchema }> | undefined
const load = () =>
  (engine ??= import('graphql').then(
    (g) => ({ graphql: g.graphql, schema: g.buildSchema(SDL) }),
    (e: unknown) => { engine = undefined; throw e }, // a failed download is tried again next time
  ))

type Failure = 'hang' | 'offline' | 500
const FAILURES = new Map<string, Failure>([['slow', 'hang'], ['offline', 'offline'], ['500', 500]])

const answer = (status: number, body: unknown): Route => ({ kind: 'answer', status, body, delay: 140 })
const refuse = (message: string) => answer(400, { errors: [{ message }] })

function parseBody(body: string): { query?: unknown; variables?: unknown; operationName?: unknown } | undefined {
  try {
    const parsed: unknown = JSON.parse(body)
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** The operation's name, for the network panel: `operationName`, or the first named operation. */
export function operationName(body: string): string | undefined {
  const req = parseBody(body)
  if (typeof req?.operationName === 'string') return req.operationName
  return typeof req?.query === 'string' ? /\b(?:query|mutation|subscription)\s+([_A-Za-z]\w*)/.exec(req.query)?.[1] : undefined
}

export async function executeGraphQL(body: string, people: Person[]): Promise<Route> {
  const req = parseBody(body)
  if (!req) return refuse('The body must be JSON: { "query": "…", "variables": { … } }')
  if (typeof req.query !== 'string') return refuse('The body has no "query" string.')
  const { graphql, schema } = await load()

  // The first failure id a resolver meets decides how the whole answer fails.
  let failure: Failure | undefined
  const user = (id: string): Person | null => {
    const fails = FAILURES.get(id)
    if (fails) { failure ??= fails; return null }
    const found = people.find((p) => p.id === id)
    if (!found) throw new Error('User not found')
    return found
  }
  const rootValue = {
    user: ({ id }: { id: string }) => user(id),
    users: () => people,
    renameUser: ({ id, name }: { id: string; name: string }) => {
      const found = user(id)
      if (found) found.name = name
      return found
    },
  }
  const variables = req.variables && typeof req.variables === 'object' ? (req.variables as Record<string, unknown>) : undefined
  const result = await graphql({
    schema, source: req.query, rootValue, variableValues: variables,
    operationName: typeof req.operationName === 'string' ? req.operationName : undefined,
  })

  if (failure === 'hang') return { kind: 'hang' }
  if (failure === 'offline') return { kind: 'offline', delay: 60 }
  if (failure === 500) return { kind: 'answer', status: 500, body: { message: 'Internal error' }, delay: 110 }
  return answer(200, result)
}
