---
title: "getHeaders()"
order: 6
---
Every method on a client has `getHeaders()`, which returns the headers its endpoint sends from configuration. Those are the client's headers merged with the endpoint's, with the endpoint's winning, and every name is lowercase.

```ts
import { createApi, defineRequest } from 'liaise'

const api = createApi({
  baseUrl: 'https://api.example.com',
  headers: { 'X-Api-Version': '1', 'X-Client': 'web' },
  requests: {
    getUser: defineRequest<{ id: string }>()({
      method: 'GET',
      path: '/users/:id',
      headers: { 'X-Api-Version': '2' },
    }),
  },
})

api.getUser.getHeaders() // { 'x-api-version': '2', 'x-client': 'web' }
```

- **It leaves out per-call headers, headers a middleware sets, and the `Content-Type` liaise picks from the body.** Those exist only once a call happens.
- **It returns a new plain object each time.** Changing it changes nothing.
- **An invalid configured header gives `{}`.** A value with a character outside Latin-1, or a name with a space, would make a `Headers` object throw, and `getHeaders()` never throws.
- **GraphQL operations have it too**, including `graphql.query.getCategory.getHeaders()` and `graphql.mutation.updateCategory.getHeaders()` on a client split into queries and mutations.
