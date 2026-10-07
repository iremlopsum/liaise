---
title: "Quick start"
order: 2
---
Define two endpoints, create a client, and make a call.

<!-- tested: quick-start -->
```ts
import { createApi, defineRequest } from 'liaise'

type User = { id: string; name: string; email: string }

// 1. Describe your endpoints. The path decides which params are required.
const getUser = defineRequest<User>()({ method: 'GET', path: '/users/:id' })
const createUser = defineRequest<User, { name: string; email: string }>()({
  method: 'POST',
  path: '/users',
})

// 2. Create the client.
const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUser, createUser },
})

// 3. Call it. This never throws: you always get { data, error }.
const { data, error } = await api.getUser({ id: '42' })

if (error) {
  // error.kind says what went wrong: 'http', 'network', 'timeout', ...
  console.error(error.kind, error.status)
} else {
  console.log(data.name) // data is a User here
}
```

## What you just got

- The params are checked against the path, so `getUser({ userId: '42' })` is a compile error.
- `data` is typed from `defineRequest<User>`.
- Nothing throws, not even when you're offline.
- Checking `error` first narrows `data` to `User`, so you never write `data!`.

## Next

- [Handling errors](/guide/handling-errors/)
- [Add an auth header and refresh the token on a 401](/recipes/add-an-auth-header-and-refresh-the-token-on-a-401/)
- [Use with TanStack Query](/recipes/use-with-tanstack-query/)
- [Use with React](/recipes/use-with-react/)
