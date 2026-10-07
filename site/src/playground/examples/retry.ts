import { createApi, defineRequest } from 'liaise'
import { retryMiddleware } from 'liaise/middleware'

type User = { id: string; name: string }

const getUser = defineRequest<User>()({
  method: 'GET',
  path: '/users/:id',
  timeout: 3000, // one deadline for the whole call, retries included
})

const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUser },
  middleware: [retryMiddleware(3)], // retries 5xx responses
})

// 'flaky' fails twice, then answers.
const { data, error } = await api.getUser({ id: 'flaky' })

if (error) console.log('gave up:', error.kind, error.status)
else console.log('got', data.name, 'on the third try')
