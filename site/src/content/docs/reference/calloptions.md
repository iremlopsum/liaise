---
title: "CallOptions"
order: 5
---
The second argument of every call, as in `api.getUser(params, options)`. [`paginate`](/guide/pagination/) takes the same options and applies them to every page.

| Option | Type | Default | What it does |
| ------ | ---- | ------- | ------------ |
| `middleware` | `Middleware[]` | — | Runs after the client's and the endpoint's middleware. Under `share`, what it changes in the request is part of what is compared. |
| `skipMiddleware` | `Middleware[]` | — | Middleware to leave out of this call, matched by reference ([details](/guide/writing-middleware/#skipping-a-middleware-for-one-call)). |
| `headers` | `HeadersInit` | — | Replaces the client's and the endpoint's value for the same header. Under `share` they are part of what is compared, so identical per-call headers share. |
| `signal` | `AbortSignal` | — | Cancels the call, which ends with `kind: 'abort'` ([details](/guide/cancelling-deadlines-and-stale-requests/#cancel-with-a-signal)). |
| `timeout` | `number` (ms) | the endpoint's `timeout`, else the client's | Replaces the endpoint's and the client's deadline for this call. `0` turns it off. Under `share`, it bounds only this caller's wait ([details](/guide/sharing-identical-requests/)). |

A fractional `timeout` is rounded down to whole milliseconds, with a minimum of 1 ms. A value above the timer limit of 2³¹ − 1 ms is capped there. Zero or a negative number means no deadline.
