---
title: "createGraphQL options"
order: 2
---
`createGraphQL(config)` takes a `GraphQLBaseConfig`, plus either `operations` or `queries` and `mutations` ([Queries and mutations](/guide/graphql/#queries-and-mutations)).

| Option | Type | Default | What it does |
| ------ | ---- | ------- | ------------ |
| `endpoint` | `string` | required | The full URL of the GraphQL endpoint. |
| `middleware` | `Middleware[]` | — | Runs on every operation, before operation and call middleware. |
| `headers` | `HeadersInit` | — | Sent with every operation. An operation or a call can replace a header. |
| `timeout` | `number` (ms) | no deadline | A deadline for every operation. An operation or a call can set its own, and `0` there turns it off. |
| `log` | `boolean \| LogOptions` | off | Logs every call to the console ([Log every call](/guide/retries-caching-and-logging/#log-every-call), [options](/reference/built-in-middleware-options/#log-options)). |
| `onError` | `(error: ApiError) => void` | — | Called once per failed call, GraphQL errors included. Calls that share one failed request count as one. Never for `'abort'`. |
