---
title: "Writing middleware"
order: 9
---
Some things belong on every call, such as an auth header or tracing, and you don't want to repeat them at each call site. A middleware is a function that wraps a call. It sees the request before it is sent and the `Result` after.

```ts
import { createApi, defineRequest, type Middleware } from 'liaise'

type User = { id: string; name: string }

const auth: Middleware = async (ctx, next) => {
  // Before: change the request
  ctx.request.headers.set('Authorization', `Bearer ${getToken()}`)

  // Run the rest of the chain, ending in fetch
  const result = await next()

  // After: read or change the result
  return result
}

const getUser = defineRequest<User>()({ method: 'GET', path: '/users/:id' })

const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUser },
  middleware: [auth],
})
```

`getToken` stands for wherever you keep the token.

Each middleware wraps the next, like the layers of an onion. The request passes in through every layer to `fetch`, and the `Result` passes back out through the same layers:

```text
call → [client middleware → [endpoint middleware → [call middleware → [fetch]]]]
```

A middleware can:

- **Change the request.** Set headers, change the body, rewrite the URL.
- **Answer early** without calling `next()`, for example from a cache.
- **Call `next()` more than once**, for example to retry a 5xx.
- **Read the result** to log it, report an error or transform `data`.

Middleware runs at three levels, the client's first and the call's last, as [Three levels of settings](/start/how-it-fits-together/#three-levels-of-settings) shows.

## Skipping a middleware for one call

Pass the middleware itself in `skipMiddleware`:

```ts
import { createApi, defineRequest } from 'liaise'
import { retryMiddleware, logMiddleware } from 'liaise/middleware'

type User = { id: string; name: string }

const getUser = defineRequest<User>()({ method: 'GET', path: '/users/:id' })
const retry = retryMiddleware(3)

const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUser },
  middleware: [retry, logMiddleware],
})

// No retries for this one call
await api.getUser({ id: '42' }, { skipMiddleware: [retry] })
```

liaise compares by reference (`===`). Store what a factory such as `retryMiddleware(3)` returns in a variable first. Calling the factory again makes a new function, which won't match.

## What a middleware sees

`ctx.requestName` is the endpoint's key, such as `'getUser'`. `ctx.request` holds the request as it will be sent, with the URL filled in and the body serialized. Every field is listed under [MiddlewareContext](/reference/middlewarecontext/).

## Signals in middleware

`ctx.request.signal` combines the caller's `signal` with the call's deadline, and is `undefined` when there is neither. liaise reads it when it calls `fetch`, so a middleware can replace it. [Give each attempt its own timeout](/recipes/give-each-attempt-its-own-timeout/) does this, and says what happens to a caller's cancel. How a replaced signal works with `share` and `dedupe` is under [Signal-replacing middleware](/reference/behaviour-in-detail/#signal-replacing-middleware).

**Pass `ctx.request.signal` on to async work your middleware does itself**, such as a token refresh, a lookup or a queue. liaise won't wait for that work past the deadline or the caller's cancel ([Timeout backstop](/reference/behaviour-in-detail/#timeout-backstop)). A promise can't be stopped from outside, so passing the signal is the only way to end the work. Without it, the work keeps running and its result is thrown away.

## Example: report server errors

This middleware sends every 5xx to Sentry, with the method and URL:

```ts
import type { Middleware } from 'liaise'
import * as Sentry from '@sentry/browser'

const reportServerErrors: Middleware = async (ctx, next) => {
  const result = await next()

  if (result.error && result.error.status >= 500) {
    Sentry.captureMessage(`API error: ${ctx.request.method} ${ctx.request.url}`, {
      extra: { status: result.error.status, body: result.error.body },
    })
  }

  return result
}
```
