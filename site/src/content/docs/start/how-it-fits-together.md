---
title: "How it fits together"
order: 3
---
liaise has four pieces, and every call takes the same path through them. Middleware is a function that wraps a call, so it can add a header, retry or log.

## Four pieces

| Piece | What it is |
| ----- | ---------- |
| Endpoint definition (`defineRequest`) | A recipe for one endpoint: its method, its path and the types of its params and response. It does nothing on its own. |
| Client (`createApi`) | Turns your recipes into typed functions, one per endpoint. |
| Call | `api.getUser(params, options)`, where `options` can set `signal`, `timeout`, `headers` or `middleware` for this call only. |
| `Result` | `{ data, error, response, retry }`, which is what every call returns. `data` and `error` are never both set. `retry()` runs the same call again. |

Types flow from the endpoint definition through `createApi` to every call, so you never annotate a call. When you need a type by name, it is listed under [Exports](/reference/exports/).

## The path of one call

```text
params → URL + body → your middleware → fetch → parse → validate → Result
```

Any step can fail, and the failure lands in `error` instead of being thrown.

## Three levels of settings

You can write a setting in three places: on the client, on the endpoint, or on one call. For headers and `timeout`, the most specific one wins. For middleware, every level runs, the client's first.

| Level | Where you write it | `headers` | `middleware` | `timeout` |
| ----- | ------------------ | --------- | ------------ | --------- |
| Client | `createApi({ headers, middleware, timeout })` | Sent with every call | Runs first, around everything else | Applies to every call |
| Endpoint | `defineRequest<T>()({ headers, middleware, timeout })` | Replaces the client's value for the same header | Runs second | Replaces the client's |
| Call | `api.getUser(params, { headers, middleware, timeout })` | Replaces the client's and the endpoint's value for the same header | Runs last, closest to `fetch` | Replaces the endpoint's and the client's |

Headers merge by name, so setting one header on a call keeps every other header from the client and the endpoint. A `Content-Type` you set at any level replaces the one liaise picks from the body.

```ts
import { createApi, defineRequest } from 'liaise'

type Report = { total: number }

const api = createApi({
  baseUrl: 'https://api.example.com',
  headers: { 'x-api-version': '1' }, // every call
  requests: {
    getReport: defineRequest<Report>()({
      method: 'GET',
      path: '/report',
      headers: { 'x-api-version': '2' }, // this endpoint: replaces the client's
    }),
  },
})

await api.getReport() // sends x-api-version: 2
await api.getReport({}, { headers: { 'x-api-version': '3' } }) // sends x-api-version: 3

api.getReport.getHeaders() // { 'x-api-version': '2' }
```

[`getHeaders()`](/reference/getheaders/) shows the headers an endpoint sends from the client and the endpoint, before any call adds its own.

`timeout: 0` at the most specific level means no deadline ([details](/guide/cancelling-deadlines-and-stale-requests/#set-a-deadline-with-timeout)).
