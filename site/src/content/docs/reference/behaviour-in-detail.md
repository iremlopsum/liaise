---
title: "Behaviour in detail"
order: 12
---
Edge cases the guide links to.

## Cache key

`cacheMiddleware` keys each entry on the endpoint name, the method, the full URL, the params and every request header except `Content-Type`. A different `Authorization`, base URL or query value gets its own entry.

The query string is sorted by name before it goes in the key, so `?a=1&b=2` and `?b=2&a=1` are one entry. It is sorted by the raw, undecoded name, and repeated names keep their order. A query param that a middleware adds before the cache, such as `?lang=de`, is part of the key.

Params are keyed by content. Object keys are sorted, and an `undefined` member is dropped, so `{ a: undefined }` and `{}` match. A value with a `toJSON` method is keyed by what it returns, so a `Date` is its ISO string. A `Map`, `Set` or typed array is keyed by its entries.

A call is never cached, and never served from the cache, when its params hold any of these, at any depth:

- a BigInt
- a function or a symbol
- an `ArrayBuffer`, `Blob`, `FormData` or `URLSearchParams`
- a boxed primitive, such as `new String('a')`
- a circular structure
- an object with no enumerable keys that isn't a plain object, such as an `Error`, a `Promise`, or a class instance that keeps its state in private fields

Each `cacheMiddleware()` call makes its own store, so two stores never share entries.

## Share key and refcount

Under `share`, two calls join one request when all of these match. They are read as the request is about to be sent, after every middleware has run.

- The endpoint's name. Two endpoints can hit one URL with a different `responseType` or schema.
- The method and the full URL, query string included, exactly as sent.
- Every header, by lowercase name, except the tracing headers below.
- The body, when it is absent, a string (every JSON body is one) or `URLSearchParams`. Any other body has no key, so that call sends its own request.

The URL is read as written. A `baseUrl` without a leading slash is resolved by the browser when the request is sent, so give a `share` endpoint an absolute or root-relative `baseUrl`.

The tracing headers are `traceparent`, `tracestate`, `baggage`, `sentry-trace`, `x-request-id` and `x-correlation-id`. They identify a request for tracing and don't change the answer. `baggage` can carry tenant or user IDs, and two calls that differ only there still share. Auth headers and cookies always stay in the key.

The response is read once, and each caller decodes its own copy, so each has its own `data` for JSON and text. A `Blob`, `ArrayBuffer` or `FormData` result is handed to every caller as the same object, because copying it would cost the bytes `share` saves.

Each caller holds a place in the shared request, counted by a refcount. A caller whose own `signal` or deadline fires gives up its place and stops waiting. When the last caller gives up, the request is aborted. Nobody is left to receive that abort, so it is never reported.

The shared request's deadline is the endpoint's `timeout`, or the client's when the endpoint has none, counted from when the request was sent. A caller that joins late can't extend it, and `timeout: 0` on one call can't turn it off. If each new caller restarted it, a steady stream of callers could keep one request open forever.

Every caller that runs out of the endpoint's or the client's `timeout` while it waits counts as one failure, and `onError` hears about it once. If the shared request then fails another way for callers still waiting, such as with a 500, that failure is reported too. A per-call `timeout` is its caller's own, and is reported on its own.

A retry from `retryMiddleware` is a new attempt. It joins an identical attempt in flight at that moment, and otherwise sends its own. Nothing is kept between attempts. Each caller's `result.retry()` runs that caller's own call again, with its own options.

## Signal-replacing middleware

A middleware can replace `ctx.request.signal`, as [Give each attempt its own timeout](/recipes/give-each-attempt-its-own-timeout/) shows.

Under `share`, the shared request is sent with a signal of its own. It fires only when every caller has given up or the shared deadline passes. A caller's own signal or deadline, and a signal its middleware installed, each release only that caller, whichever fires first. So a replaced signal that never fires can't keep a caller waiting past its own cancel.

Under `dedupe`, liaise merges the dedupe signal into yours, so the request ends when either one fires. The dedupe signal is added when `fetch` is called. A middleware that reads `ctx.request.signal` before `next()` sees only the caller's signal and the deadline.

## Timeout backstop

A middleware may wait on work of its own before it calls `next()`, such as a token refresh. If that work never settles, the call still ends at its deadline. Here `user` stands for your auth client:

```ts
const auth: Middleware = async (ctx, next) => {
  const token = await user.getIdToken() // stalls on a bad network
  ctx.request.headers.set('Authorization', `Bearer ${token}`)
  return next()
}
// With timeout: 45_000, the call still settles after about 45 s: kind 'timeout', status 0.
```

When the deadline passes, the chain gets one macrotask to answer on its own. That is enough for anything that already reacts to the abort: `fetch` rejecting, a middleware rethrowing the reason, or a fallback that turns a timeout into a cached response. Each of those keeps its own `Result`.

A chain still waiting after that is stuck on something the signal doesn't reach. The call then settles with `kind: 'timeout'` and `status: 0`, and `onError` is called once. A caller's `signal` works the same way, with `kind: 'abort'`, which `onError` never sees.

The stuck middleware keeps running, because a promise can't be cancelled. Whatever it returns or throws later is discarded, with no second `Result` and no second `onError`. If it calls `next()` after the call has settled, nothing is sent, and `next()` returns the `Result` the caller already has.

## Abort classification

liaise decides whether a failure is a cancellation by checking whether this call's own signal aborted. The thrown value's name and type don't matter. A custom reason, such as `controller.abort(new Error('unmounted'))` or a plain string, still gives `kind: 'abort'`, and a deadline gives `'timeout'`.

A middleware that rethrows liaise's own abort or timeout reason, as it is or wrapped once as the `cause` of another error, gives `'abort'` or `'timeout'` too. Anything else a middleware throws is `'middleware'`.

## baseUrl query merging

A `baseUrl` can carry its own query string, such as a fixed `api-version`. Its params go in front of the call's:

```ts
import { createApi, defineRequest } from 'liaise'

type Hit = { id: string }

const search = defineRequest<Hit[], { q: string }>()({ method: 'GET', path: '/search' })
const api = createApi({ baseUrl: 'https://api.example.com/v1?api-version=2', requests: { search } })

await api.search({ q: 'hello' })
// GET https://api.example.com/v1/search?api-version=2&q=hello
```

A key that appears in both is sent twice. A call param named `api-version` gives `?api-version=2&api-version=3`, and the server decides which one counts. Headers merge by name, but query params can't, because an array param is already sent as repeated keys (`tags=a&tags=b`). To change a base param on each call, set it in a middleware.

The full URL, base query included, appears in `ctx.request.url`, `error.request.url` and the [log](/guide/retries-caching-and-logging/#log-every-call) output, so anything that logs or reports it sends that query too. Put a secret in a header instead.

## URL fragments

A `#` written into a `path` or a `baseUrl` is refused, because a fragment is never sent to the server. The call returns an error with `kind: 'network'` and a `TypeError` in `error.body` that names the value. Nothing is sent. liaise refuses the fragment instead of stripping it, so the dead part doesn't stay in your code.

`defineRequest` also refuses a fragment in a `path` literal, at compile time:

```ts
// @ts-expect-error
defineRequest<Doc>()({ method: 'GET', path: '/docs#section' })
//                                          ^ Property '__fragmentInPath' is missing:
//                                            a URL fragment is never sent to the server
```

The check reads the literal. A path built at runtime, or a variable typed as `RequestConfig`, still compiles and is refused when it is called. `new Request` has no compile-time check.

A `#` inside a param value is data. It is escaped to `%23` and sent:

```ts
await api.getDoc({ id: 'a#b' })   // GET /docs/a%23b
await api.search({ tag: 'a#b' })  // GET /search?tag=a%23b
```

## Stream bodies

A `ReadableStream` body is used up as it is sent, so liaise can't send it again. A second attempt, from `retryMiddleware` or `result.retry()`, returns `kind: 'network'` and `status: 0`, with a `TypeError` that tells you to read the stream into a `Blob` or `ArrayBuffer` first. Under `retryMiddleware` that error is the final `Result`, so the 5xx that caused the retry isn't in it.

## Empty bodies

- **A 2xx with an empty body under `'json'`** is a `'parse'` error ([Reading responses](/guide/reading-responses/)), and its `Result` still has `retry()`.
- **A non-2xx with an empty body** is an ordinary `'http'` error with `error.body` set to `null`. So is a non-2xx whose JSON body doesn't parse, such as an HTML page from a gateway. Nobody promised a body on failure, so neither is a `'parse'` error.
- **On GraphQL**, a 2xx with neither `data` nor `errors` is a `'parse'` error with the raw text in `error.body` ([GraphQL errors](/guide/graphql/#graphql-errors)). That includes a root of `null`, a number or an array. Each is valid JSON, but GraphQL requires an object.
