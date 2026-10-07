---
title: "One /me per page view on the server"
order: 6
---
On the server there's no store. A page's loaders run in parallel and each one needs the current user. `User` and `IncomingRequest` stand for your types; `cookie` stands for however you pass the user's identity.

<!-- tested: server-loaders -->
```ts
import { createApi, defineRequest } from 'liaise'

const me = defineRequest<User>()({ method: 'GET', path: '/me', share: true })

// One client for the whole server. Sharing compares what is actually sent,
// so one user's call never joins another's.
const api = createApi({ baseUrl: 'https://users.internal', requests: { me } })

async function renderPage(req: IncomingRequest) {
  const asUser = { headers: { cookie: req.headers.cookie ?? '' } }
  const [header, cart] = await Promise.all([
    api.me({}, asUser).then(r => r.data?.name),   // header loader
    api.me({}, asUser).then(r => r.data?.cartId), // cart loader
  ])
  return { header, cart }
}
```

Each loader sends the user's cookie as a per-call header. Calls with the same cookie share one request, and calls with different cookies never do ([On a server](/guide/sharing-identical-requests/#on-a-server)). Inside React Server Components, React's [`cache()`](https://react.dev/reference/react/cache) gives one /me per page view too.
