---
title: "liaise/testing"
order: 10
---
| Export | Kind | What it is |
| ------ | ---- | ---------- |
| `mockFetch` | function | Builds a `fetch` stub that matches routes, with `install()`, `restore()`, call recording and response sequences. |
| `jsonResponse` | function | Builds a `Response` with a JSON body and a `content-type` header. |
| `successResult` | function | Builds a success `Result`, for stubbing at the `Result` level. |
| `errorResult` | function | Builds an error `Result` with a given HTTP status, for stubbing at the `Result` level. |
| `RouteContext` | type | `{ params, request }`, passed to a route function. |
| `RouteHandler` | type | `(ctx: RouteContext) => Response \| Promise<Response>`, a route value that builds its response. |
| `RouteValue` | type | `Response \| RouteHandler \| Array<Response \| RouteHandler>`, anything a route key can map to. |
| `RecordedCall` | type | `{ method, url, headers, body }`, one entry in `mock.calls`. |

How the stub behaves, beyond [Testing your code](/guide/testing-your-code/):

- **It honours `init.signal`, like real `fetch`.** A signal that is already aborted, or aborts while a route function is still pending, rejects with its `reason`. So a route that never answers, `() => new Promise(() => {})`, lets you test your own `timeout` and cancel handling.
- **An aborted call is still recorded** in `calls` and counted by `callCount`, but it doesn't use up a response from a sequence.
- **`restore()` puts back whatever `globalThis.fetch` was when `install()` ran.** If it was `undefined`, `restore()` puts back `undefined`.
- **A route key without a space**, such as `'/users'`, throws when you call `mockFetch`, and the message names the key.
- **Routes are tried in the order you wrote them**, and the first match wins. Put the more specific route first when two could match the same path.
- **Trailing and doubled slashes are ignored on both sides.** `/a/b/`, `/a//b` and `/a/b` all match the same route.
