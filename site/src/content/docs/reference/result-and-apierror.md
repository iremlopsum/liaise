---
title: "Result and ApiError"
order: 7
---
Every call returns a `Result`. `data` and `error` are never both set, so checking `error` narrows `data`.

```ts
interface SuccessResult<TResponse> {
  data: TResponse
  error: null
  response: Response                       // always present on success
  retry: () => Promise<Result<TResponse>>
}

interface ErrorResult<TResponse> {
  data: null
  error: ApiError
  response: Response | null                // null when no response arrived
  retry: () => Promise<Result<TResponse>>
}

type Result<TResponse> = SuccessResult<TResponse> | ErrorResult<TResponse>
```

`response` is set for `'http'` and `'parse'` errors, where the server answered. It is `null` for `'network'`, `'abort'`, `'timeout'` and `'middleware'`.

`ApiError` is the `error` of a failed call. It is a plain class and doesn't extend `Error`.

| Property | Type | What it holds |
| -------- | ---- | ------------- |
| `kind` | `ApiErrorKind` | What went wrong. The [kinds table](/guide/handling-errors/) says what each one means. If you build an `ApiError` yourself, for example in a middleware, `kind` is required. |
| `status` | `number` | The response's status for `'http'` and `'parse'`. `0` for `'network'`, `'abort'`, `'timeout'` and `'middleware'`. |
| `statusText` | `string` | The response's status text, `'GraphQL Error'` for a GraphQL error, and `''` when no response arrived. |
| `body` | `unknown` | For `'http'`, the error body, or `null` when it is empty or doesn't parse. For `'parse'`, what the [Validating responses](/guide/validating-responses/) and [Reading responses](/guide/reading-responses/) rules say. Otherwise, the thrown value. |
| `headers` | `Headers` | The response headers. Empty when no response arrived. |
| `request` | `{ method, url, params }` | The failed request. `url` is the address with the params filled in. It is the path template only when the URL couldn't be built. |
| `partialData` | `unknown` (optional) | For a GraphQL error, the data the server sent with the errors. `undefined` for every REST error. |

```ts
type ApiErrorKind = 'http' | 'network' | 'abort' | 'timeout' | 'parse' | 'middleware'
```

You can check for an `ApiError` with `instanceof`:

```ts
import { ApiError } from 'liaise'

if (error instanceof ApiError) {
  console.error(error.kind, error.status)
}
```
