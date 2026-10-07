import { createApi, defineRequest } from 'liaise'

type User = { id: string; name: string }

const getUser = defineRequest<User>()({
  method: 'GET',
  path: '/users/:id',
  share: true, // identical calls in flight share one request
})
const api = createApi({ baseUrl: 'https://api.example.com', requests: { getUser } })

// Five components ask for the same user at the same moment.
const results = await Promise.all(
  [1, 2, 3, 4, 5].map(() => api.getUser({ id: '42' })),
)

const answered = results.filter((r) => r.data).length
console.log(`${answered} of ${results.length} callers got the user`)
