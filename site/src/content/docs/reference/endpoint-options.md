---
title: "Endpoint options"
order: 3
---
`defineRequest<T>()(config)` and `new Request(config)` take a `RequestConfig`.

| Option | Type | Default | What it does |
| ------ | ---- | ------- | ------------ |
| `method` | `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'` | required | The HTTP method. |
| `path` | `string` | required | The path after `baseUrl`. Each `:name` is filled from the params ([Defining endpoints](/guide/defining-endpoints/)). |
| `middleware` | `Middleware[]` | — | Runs on every call to this endpoint, after client middleware. |
| `headers` | `HeadersInit` | — | Sent with every call to this endpoint. Replaces the client's value for the same header. |
| `responseType` | `'json' \| 'text' \| 'blob' \| 'arrayBuffer' \| 'formData' \| 'none'` | `'json'` | How the response body is read ([Reading responses](/guide/reading-responses/)). |
| `schema` | `StandardSchemaV1` | — | Checks a 2xx body, and `data` becomes the schema's output ([Validating responses](/guide/validating-responses/)). |
| `dedupe` | `boolean` | `false` | A new call cancels the one still running ([details](/guide/cancelling-deadlines-and-stale-requests/#drop-stale-calls-with-dedupe)). |
| `share` | `boolean` | `false` | Calls that would send the identical request share one network request ([details](/guide/sharing-identical-requests/)). Can't be combined with `dedupe`. |
| `bodyAs` | `'query' \| 'body'` | `'query'` for `GET` and `DELETE`, `'body'` for the rest | Where the params that aren't in the path go. |
| `timeout` | `number` (ms) | the client's `timeout` | One deadline for the whole call, retries included. Replaces the client's, and `0` turns it off ([details](/guide/cancelling-deadlines-and-stale-requests/#set-a-deadline-with-timeout)). |
