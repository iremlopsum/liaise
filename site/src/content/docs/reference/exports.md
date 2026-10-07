---
title: "Exports"
order: 11
---
Each entry point is a separate import, and your bundler leaves out what you don't import. Gzipped, as measured by `npm run size`: about 6.2 kB for a REST-only import, 7.5 kB for the whole core entry, and 9.2 kB with all the middleware.

**`liaise`**

| Export | Kind | What it is |
| ------ | ---- | ---------- |
| `createApi` | function | Creates a REST client from your endpoints. |
| `defineRequest` | function | Defines an endpoint, with params checked against the path. |
| `Request` | class | The endpoint class that `defineRequest` builds ([Without defineRequest](/guide/defining-endpoints/#without-definerequest)). |
| `paginate` | function | Walks a paginated endpoint, one `Result` per page. |
| `ApiError` | class | The `error` of a failed call. |
| `createGraphQL` | function | Creates a GraphQL client from your operations. |
| `Operation` | class | Defines one GraphQL operation. |
| `gql` | function | Marks a template string as GraphQL for your editor, and returns it as a plain string. |
| `Result`, `SuccessResult`, `ErrorResult` | type | What every call returns, and its two branches. |
| `ApiErrorKind` | type | The union of `error.kind` values. |
| `CallOptions` | type | The second argument of a call. |
| `PaginateOptions` | type | `next`, `maxPages`, and any `CallOptions`. |
| `ApiConfig`, `RequestConfig` | type | The configs of `createApi` and an endpoint. |
| `LogOptions` | type | The options of `log` and `logMiddleware(options)` ([Log options](/reference/built-in-middleware-options/#log-options)). |
| `GraphQLBaseConfig`, `OperationConfig` | type | The configs of `createGraphQL` and an `Operation`. |
| `GraphQLError` | type | One entry of a GraphQL `errors` array. |
| `Middleware`, `MiddlewareContext`, `MiddlewareNext` | type | A middleware, its `ctx`, and its `next`. |
| `StandardSchemaV1`, `InferOutput`, `StandardIssue` | type | The Standard Schema interface, the type a schema produces, and one validation issue. |

**`liaise/middleware`**

| Export | Kind | What it is |
| ------ | ---- | ---------- |
| `retryMiddleware` | function | Returns a middleware that retries failed calls ([RetryOptions](/reference/built-in-middleware-options/#retryoptions)). |
| `cacheMiddleware` | function | Returns a middleware that caches successes in memory ([Cache options](/reference/built-in-middleware-options/#cache-options)). |
| `logMiddleware` | middleware | Logs each call to the console. Use it as it is, or call it with options ([Log options](/reference/built-in-middleware-options/#log-options)). |
| `RetryOptions`, `RetryInfo` | type | The options of `retryMiddleware`, and the argument to `onRetry`. |
| `CacheMiddleware` | type | What `cacheMiddleware()` returns, a `Middleware` with `clear()`. |
| `LogMiddleware` | type | The type of `logMiddleware`, a `Middleware` you can also call with `LogOptions`. |

**`liaise/testing`** exports are listed under [liaise/testing](/reference/liaisetesting/).
