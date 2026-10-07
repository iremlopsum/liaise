---
title: "Validating responses"
order: 5
---
TypeScript trusts the type you write, and nothing checks it at runtime. When the backend changes a field, the page crashes three components later. Give the endpoint a schema, and the response is checked before you see it.

```ts
import { createApi, defineRequest } from 'liaise'
import { z } from 'zod'

const getUser = defineRequest()({
  method: 'GET',
  path: '/users/:id',
  schema: z.object({ id: z.string(), name: z.string() }),
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { getUser } })

const { data, error } = await api.getUser({ id: '42' })
//      ^? { id: string; name: string } | null
```

Valibot and ArkType work the same way:

```ts
import * as v from 'valibot'
import { type } from 'arktype'

const withValibot = defineRequest()({
  method: 'GET',
  path: '/users/:id',
  schema: v.object({ id: v.string(), name: v.string() }),
})

const withArkType = defineRequest()({
  method: 'GET',
  path: '/users/:id',
  schema: type({ id: 'string', name: 'string' }),
})
```

- **Any [Standard Schema](https://standardschema.dev) validator works.** liaise doesn't depend on any of them. Standard Schema is only an interface, so you bring the validator you already use.
- **The schema supplies the response type.** You write no type argument, so there's no second type to keep in sync.
- **`data` is the schema's output.** A schema that transforms changes what you receive, so `data` can differ from the raw response:

  <!-- untyped: needs zod's real output types (z is only a placeholder here), and getUser is not wired into the api from earlier blocks -->
  ```ts
  const getUser = defineRequest()({
    method: 'GET',
    path: '/users/:id',
    schema: z.object({
      id: z.string(),
      createdAt: z.coerce.date(),        // the wire sends a string
      role: z.string().default('user'),  // absent on the wire
    }),
  })

  const { data } = await api.getUser({ id: '42' })
  data.createdAt   // a real Date
  data.role        // 'user' when the server left it out
  ```

- **A response the schema refuses is a `'parse'` error.** Nothing is thrown. `error.body` holds the validator's issues, and `error.status` is the response's own status, since the server answered fine:

  ```ts
  const { error } = await api.getUser({ id: '42' })
  if (error?.kind === 'parse') {
    console.error(error.body)  // the validator's issues
  }
  ```

- A validator that throws is a `'parse'` error too, with the thrown value in `error.body`.
- **Only a 2xx body is validated.** A non-2xx body is diagnostic and often a different shape, so it is left alone.
- **The GraphQL `Operation` ([GraphQL](/guide/graphql/)) takes `schema` too**, and validates the response's `data`. There the response type stays explicit, because only `defineRequest` infers it:

  ```ts
  import { Operation, gql } from 'liaise'

  const UserSchema = z.object({ id: z.string(), name: z.string() })

  const me = new Operation<Record<string, never>, z.infer<typeof UserSchema>>({
    operation: gql`query { me { id name } }`,
    schema: UserSchema,
  })
  ```
