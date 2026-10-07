import { createApi, defineRequest } from 'liaise'

type User = { id: string; name: string }

const getUser = defineRequest<User>()({
  method: 'GET',
  path: '/users/:id',
  timeout: 1000,
})
const api = createApi({ baseUrl: 'https://api.example.com', requests: { getUser } })

// Each id makes the fake server fail in a different way.
for (const id of ['42', '404', '500', 'offline', 'slow']) {
  const { data, error } = await api.getUser({ id })

  if (error) console.log(id, '→', error.kind, error.status)
  else console.log(id, '→', data.name)
}
