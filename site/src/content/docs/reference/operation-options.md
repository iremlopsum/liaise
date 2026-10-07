---
title: "Operation options"
order: 4
---
`new Operation(config)` takes an `OperationConfig`.

| Option | Type | Default | What it does |
| ------ | ---- | ------- | ------------ |
| `operation` | `string` | required | The GraphQL document, sent as `query` in the body. |
| `middleware` | `Middleware[]` | — | Runs on every call to this operation, after client middleware. |
| `headers` | `HeadersInit` | — | Sent with every call to this operation. Replaces the client's value for the same header. |
| `dedupe` | `boolean` | `false` | A new call cancels the one still running. |
| `share` | `boolean` | `false` | Calls that would send the identical request share one network request ([details](/guide/sharing-identical-requests/)). Variables must match exactly, key order included. Can't be combined with `dedupe`. |
| `schema` | `StandardSchemaV1` | — | Checks the response's `data`. The response type stays explicit ([Validating responses](/guide/validating-responses/)). |
| `timeout` | `number` (ms) | the client's `timeout` | One deadline for the whole call, retries included. Replaces the client's, and `0` turns it off. |
