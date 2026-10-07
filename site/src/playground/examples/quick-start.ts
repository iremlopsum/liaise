import { createApi, defineRequest } from 'liaise'

type User = { id: string; name: string; email: string }

// The path decides which params are required.
const getUser = defineRequest<User>()({ method: 'GET', path: '/users/:id' })

const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUser },
})

// This never throws: you always get { data, error }.
const { data, error } = await api.getUser({ id: '42' })

if (error) {
  console.log(error.kind, error.status)
} else {
  console.log(`Hello, ${data.name}`) // data is a User here
}
