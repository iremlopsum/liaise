---
title: "MiddlewareContext"
order: 8
---
The first argument of every middleware, `ctx`:

| Property | Type | What it holds |
| -------- | ---- | ------------- |
| `request.method` | `string` | The HTTP method, such as `'GET'`. |
| `request.url` | `string` | The full URL, with path params and query string filled in. |
| `request.path` | `string` | The path template, such as `'/users/:id'`. |
| `request.params` | `unknown` | The params as the caller passed them. |
| `request.headers` | `Headers` | The merged headers. A middleware can add, change or remove them. |
| `request.body` | `unknown` | The serialized body, or `null` when there is none. |
| `request.signal` | `AbortSignal \| undefined` | The signal `fetch` receives. Under `share` it is the signal this caller waits on, because the shared request has its own. A middleware can replace it ([Signals in middleware](/guide/writing-middleware/#signals-in-middleware)). |
| `requestName` | `string` | The endpoint's key, such as `'getUser'`. |

How a replaced signal works with `share` and `dedupe` is under [Signal-replacing middleware](/reference/behaviour-in-detail/#signal-replacing-middleware).
