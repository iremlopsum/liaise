---
title: "Retry a flaky backend within one deadline"
order: 7
---
Use this when a backend sometimes fails with a 5xx, a rate limit or a dropped connection, and you still want an answer within a fixed time.

<!-- tested: flaky-backend -->
```ts
import { createApi, defineRequest } from 'liaise'
import { retryMiddleware } from 'liaise/middleware'

type Report = { rows: number }

const retry = retryMiddleware({
  max: 3,
  // Retry server errors, rate limits and dropped connections. Not 4xx.
  retryOn: r => {
    const e = r.error
    return !!e && (e.status >= 500 || e.status === 429 || e.kind === 'network')
  },
})

const api = createApi({
  baseUrl: '/api',
  middleware: [retry],
  requests: {
    // timeout covers every attempt and every wait between them.
    getReport: defineRequest<Report>()({ method: 'GET', path: '/report', timeout: 3000 }),
  },
})
```

With `timeout: 3000`, the caller gets an answer within three seconds however many retries are left. See [Set a deadline with timeout](/guide/cancelling-deadlines-and-stale-requests/#set-a-deadline-with-timeout).
