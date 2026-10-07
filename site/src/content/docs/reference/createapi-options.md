---
title: "createApi options"
order: 1
---
`createApi(config)` takes an `ApiConfig`.

| Option | Type | Default | What it does |
| ------ | ---- | ------- | ------------ |
| `baseUrl` | `string` | required | Goes in front of every endpoint's path. It may carry a query string ([details](/reference/behaviour-in-detail/#baseurl-query-merging)). |
| `requests` | an object of endpoints | required | Each key becomes a method on the client, such as `api.getUser`. |
| `middleware` | `Middleware[]` | — | Runs on every call, before endpoint and call middleware. |
| `headers` | `HeadersInit` | — | Sent with every call. An endpoint or a call can replace a header ([three levels](/start/how-it-fits-together/#three-levels-of-settings)). |
| `timeout` | `number` (ms) | no deadline | A deadline for every call. An endpoint or a call can set its own, and `0` there turns it off ([details](/guide/cancelling-deadlines-and-stale-requests/#set-a-deadline-with-timeout)). |
| `log` | `boolean \| LogOptions` | off | Logs every call to the console ([Log every call](/guide/retries-caching-and-logging/#log-every-call), [options](/reference/built-in-middleware-options/#log-options)). |
| `onError` | `(error: ApiError) => void` | — | Called once per failed call, after all middleware. Calls that share one failed request count as one. Never for `'abort'` ([details](/guide/handling-errors/#reporting-errors-with-onerror)). |
