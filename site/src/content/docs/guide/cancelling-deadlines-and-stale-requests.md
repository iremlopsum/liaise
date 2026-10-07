---
title: "Cancelling, deadlines and stale requests"
order: 6
---
Sometimes you no longer need a call, because the user left the page or typed a newer search. Sometimes a call takes too long. You can end a call with a signal, a deadline, or `dedupe`, and each one ends it with an error you can tell apart.

## Cancel with a signal

Pass an `AbortSignal` in the call options:

```ts
import { createApi, defineRequest } from 'liaise'

type User = { id: string; name: string }

const getUser = defineRequest<User>()({ method: 'GET', path: '/users/:id' })
const api = createApi({ baseUrl: 'https://api.example.com', requests: { getUser } })

const controller = new AbortController()
const pending = api.getUser({ id: '42' }, { signal: controller.signal })

controller.abort()

const { error } = await pending
// error.kind === 'abort', error.status === 0, error.body is a DOMException named 'AbortError'
```

A cancellation you asked for isn't reported to [`onError`](/guide/handling-errors/#reporting-errors-with-onerror). How liaise tells your cancellation apart from other failures is under [Abort classification](/reference/behaviour-in-detail/#abort-classification).

## Set a deadline with timeout

`timeout` is in milliseconds. You set it on the client, on the endpoint or on one call:

```ts
import { createApi, defineRequest } from 'liaise'
import { retryMiddleware } from 'liaise/middleware'

type Report = { total: number }

const getReport = defineRequest<Report>()({ method: 'GET', path: '/report', timeout: 3000 })

const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getReport },
  middleware: [retryMiddleware(3)],
  timeout: 10_000, // for every endpoint that sets none
})

const { error } = await api.getReport()
// If no answer arrives within 3 seconds, retries included: error.kind === 'timeout', error.status === 0
```

- **`timeout` is one deadline for the whole call.** It covers every middleware, every retry and every wait between retries. `timeout: 3000` with three retries still answers within three seconds.
- **The most specific `timeout` wins.** A call's replaces the endpoint's, and the endpoint's replaces the client's. Zero or a negative number at the winning level means no deadline, so `timeout: 0` on an endpoint opts it out of the client's, and on a call turns both off. With no `timeout` anywhere there is no deadline, which is the default.
- **`result.retry()` starts a fresh deadline.** The retried call isn't charged for time the first one used.
- If you want a separate limit for each attempt instead, see [Give each attempt its own timeout](/recipes/give-each-attempt-its-own-timeout/).
- Under [`share`](/guide/sharing-identical-requests/), the endpoint's or the client's `timeout` also bounds the one shared request ([details](/reference/behaviour-in-detail/#share-key-and-refcount)).

## Drop stale calls with dedupe

`dedupe: true` makes each new call to an endpoint cancel the one still running. Use it for search-as-you-type and fast-changing filters, where only the latest answer matters:

```ts
type User = { id: string; name: string }

const searchUsers = defineRequest<User[], { q: string }>()({
  method: 'GET',
  path: '/users/search',
  dedupe: true,
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { searchUsers } })

// Typing fast: each call cancels the one before it.
api.searchUsers({ q: 'h' })    // ends with kind 'abort'
api.searchUsers({ q: 'he' })   // ends with kind 'abort'
api.searchUsers({ q: 'hel' })  // this one completes
```

- **It works per endpoint.** A call to one endpoint never cancels a call to another.
- **A replaced call ends with `kind: 'abort'`**, so your code can ignore it.
- **It works together with your own signal and a `timeout`.** Whichever fires first ends the call.
- It can't be combined with [`share`](/guide/sharing-identical-requests/), which does the opposite.

All three still end the call when a middleware is stuck on work of its own that ignores the signal, such as a token refresh that never settles. [Timeout backstop](/reference/behaviour-in-detail/#timeout-backstop) explains how.
