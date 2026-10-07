---
title: "Load the current user into a store"
order: 5
---
The header, sidebar and avatar each check the store on first render, find it empty, and each ask for the user. `User` is your type.

<!-- tested: store-me -->
```ts
import { createApi, defineRequest } from 'liaise'

const me = defineRequest<User>()({ method: 'GET', path: '/me', share: true })
const api = createApi({ baseUrl: '/api', requests: { me } })

// Any store works the same way: Zustand, Pinia, Redux or a plain object.
const store = { user: null as User | null }

async function loadUser() {
  if (store.user) return // empty on first render, for every component
  const { data } = await api.me() // callers at the same moment join one request
  if (data) store.user = data
}
```

[TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview) dedupes this case too; this recipe is for apps using a plain store.
