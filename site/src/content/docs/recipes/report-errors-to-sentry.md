---
title: "Report errors to Sentry"
order: 9
---
Send every unexpected failure to your error tracker from one place. `Sentry` stands for your error tracker; `getUser` is the [Quick start](/start/quick-start/) endpoint.

<!-- tested: report-errors -->
```ts
import { createApi } from 'liaise'

const api = createApi({
  baseUrl: '/api',
  requests: { getUser },
  // Called once per failed call, after retries. Never for 'abort': you cancelled it.
  onError: error => {
    if (error.kind === 'http' && error.status < 500) return // expected 4xx, not a bug
    Sentry.captureException(error, {
      extra: { kind: error.kind, url: error.request.url, status: error.status },
    })
  },
})
```

`ApiError` isn't an `Error`, so it carries no stack trace or `message` of its own. Pass the fields you want to see in `extra`, as above.

Use a middleware instead when you need timing, or the request before it's sent, or want to report for some endpoints only. [Example: report server errors](/guide/writing-middleware/#example-report-server-errors) has the middleware version.
