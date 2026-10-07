---
title: "Built-in middleware options"
order: 9
---
## RetryOptions

`retryMiddleware(n)` is short for `retryMiddleware({ max: n })`, and `retryMiddleware()` means `{ max: 3 }`.

| Option | Type | Default | What it does |
| ------ | ---- | ------- | ------------ |
| `max` | `number` | `3` | Retries after the first attempt. `max: 2` means up to 3 calls in all. |
| `delay` | `'exponential' \| 'linear' \| (attempt: number) => number` | `'exponential'` | The wait before each retry. Exponential is `baseDelay * 2^(attempt-1)` and linear is `baseDelay * attempt`. A function gets the 1-based attempt and returns milliseconds. |
| `baseDelay` | `number` (ms) | `250` | The first wait, before jitter and `Retry-After`. |
| `maxDelay` | `number` (ms) | `30000` | The longest any wait can be, a `Retry-After` value included. |
| `jitter` | `boolean` | `true` | Waits a random time between 0 and the computed delay, so many clients don't retry at the same moment. Never applied to a `Retry-After` value. |
| `respectRetryAfter` | `boolean` | `true` | Uses the server's `Retry-After` header, in seconds or as a date, in place of the computed wait. `maxDelay` still caps it. |
| `retryOn` | `(result: Result<unknown>, attempt: number) => boolean` | `r => (r.error?.status ?? 0) >= 500` | Whether to retry. It gets the 1-based number of the attempt it would start, and is called even once `max` is reached. |
| `onRetry` | `(info: RetryInfo) => void` | — | Called before each wait. Its return value is ignored, and if it throws, the call goes on. |

`RetryInfo`, the argument to `onRetry`:

| Field | What it holds |
| ----- | ------------- |
| `attempt` | The retry about to run, counting from 1. |
| `max` | The configured `max`. |
| `delay` | The wait about to start, in milliseconds, after jitter and `Retry-After`. |
| `result` | The `Result` that caused this retry. |

## Cache options

`cacheMiddleware(options)` returns a middleware with a `clear()` method, typed `CacheMiddleware`.

| Option | Type | Default | What it does |
| ------ | ---- | ------- | ------------ |
| `ttl` | `number` (ms) | `300000` (5 minutes) | How long an entry is served. An expired entry is removed when it is next read. |
| `maxSize` | `number` | `50` | How many entries the store keeps. When it is full, the oldest entry is dropped. |
| `debug` | `boolean` | `false` | Logs `[liaise cache] HIT` or `MISS`, with the endpoint and its params, to the console. |

What goes into the key is under [Cache key](/reference/behaviour-in-detail/#cache-key).

## Log options

The `log` option of both clients takes a boolean or a `LogOptions`, and `logMiddleware(options)` takes a `LogOptions`. `log: true` and a bare `logMiddleware` mean `{ enabled: true, data: false }`.

| Option | Type | Default | What it does |
| ------ | ---- | ------- | ------------ |
| `enabled` | `boolean` | `true` | Turns logging on or off. With `false`, `log` does nothing and costs nothing, and `logMiddleware` passes every call straight through. |
| `data` | `boolean` | `false` | Also prints each call's data, or its `error.body` on failure. An object or array goes to `console.table`, anything else to `console.log`, which is also used where `console.table` is missing. |

Each call logs one line when it starts and one when it ends:

```text
[liaise] → <method> <endpoint> <url>
[liaise] ← <endpoint> OK (<ms>ms)
[liaise] ← <endpoint> ERROR <status> (<ms>ms)
[liaise] ← <endpoint> OK (<ms>ms, shared)
```

The time covers everything that runs inside the logger. For `log` that is the whole call, and for `logMiddleware` it is the middleware after it and the request. An error with no response logs status `0`. A console that throws never fails the call.
