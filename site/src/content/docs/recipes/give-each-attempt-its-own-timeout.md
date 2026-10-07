---
title: "Give each attempt its own timeout"
order: 8
---
liaise's `timeout` is one deadline for the whole call. If you want a limit per attempt instead, put a middleware *inside* the retry. `getUser` is the endpoint from [Quick start](/start/quick-start/).

<!-- tested: per-attempt-timeout -->
```ts
import { createApi } from 'liaise'
import type { Middleware } from 'liaise'
import { retryMiddleware } from 'liaise/middleware'

// A fresh time limit for each attempt, instead of one for the whole call.
const perAttempt = (ms: number): Middleware => async (ctx, next) => {
  ctx.request.signal = AbortSignal.timeout(ms)
  return next()
}

const api = createApi({
  baseUrl: '/api',
  requests: { getUser },
  // Order matters: retry wraps perAttempt, so every attempt gets its own 5 s.
  middleware: [
    retryMiddleware({ retryOn: r => r.error?.kind === 'timeout' || (r.error?.status ?? 0) >= 500 }),
    perAttempt(5_000),
  ],
})
```

Timeouts aren't retried by default; the `retryOn` above opts in. Because the middleware replaces `ctx.request.signal`, a caller's own cancel still ends the call as `'abort'`, but the request itself keeps running until the per-attempt signal fires.
