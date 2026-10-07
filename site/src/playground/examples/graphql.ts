import { createGraphQL, Operation, gql } from 'liaise'

type User = { name: string; posts: { title: string }[] }

// The second type is data, keyed by the field the operation selects.
const getUser = new Operation<{ id: string }, { user: User }>({
  operation: gql`query GetUser($id: ID!) { user(id: $id) { name posts { title } } }`,
})
const renameUser = new Operation<{ id: string; name: string }, { renameUser: { name: string } }>({
  operation: gql`mutation RenameUser($id: ID!, $name: String!) { renameUser(id: $id, name: $name) { name } }`,
})
const api = createGraphQL({
  endpoint: 'https://api.example.com/graphql',
  queries: { getUser },
  mutations: { renameUser },
  timeout: 1000,
})

// The same Result as REST: a GraphQL error is an error, never a throw.
const id = '42'
const { data, error } = await api.query.getUser({ id })

if (error) {
  console.log(error.kind, error.status)
  if (error.kind === 'http') console.log('body:', error.body)
  if (error.partialData) console.log('partial data:', error.partialData)
} else {
  console.log(data.user.name, 'wrote', data.user.posts.map((p) => p.title))
}

const renamed = await api.mutation.renameUser({ id, name: 'Ada King' })
if (renamed.error) console.log('rename:', renamed.error.kind, renamed.error.status)
else console.log('renamed to', renamed.data.renameUser.name)
