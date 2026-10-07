---
title: "Handling errors"
order: 2
---
Plain fetch reports failures three different ways. A 500 resolves like a success, being offline throws, and a hung server never answers. In liaise every call returns `{ data, error }`, and `error.kind` names what went wrong.

```ts
import { createApi, defineRequest } from 'liaise'

type User = { id: string; name: string }

const getUser = defineRequest<User>()({ method: 'GET', path: '/users/:id', timeout: 5000 })
const api = createApi({ baseUrl: 'https://api.example.com', requests: { getUser } })

async function loadUser(id: string) {
  const { data, error } = await api.getUser({ id })

  if (error) {
    switch (error.kind) {
      case 'http':       // the server answered with a non-2xx status
        if (error.status === 401) redirectToLogin()
        else show(`The server said no (${error.status})`)
        break
      case 'network':    // no response arrived
        show("You're offline. Try again.")
        break
      case 'timeout':    // the 5 second deadline passed
        show('This is taking too long.')
        break
      case 'abort':      // you cancelled the call, so there is nothing to show
        break
      case 'parse':      // a 2xx body that didn't parse or failed the schema
      case 'middleware': // your own middleware threw
        report(error)
        break
    }
    return
  }

  show(`Hello, ${data.name}`) // data is a User here
}
```

`show`, `redirectToLogin` and `report` stand for your own code.

| `kind` | What happened | `status` | What you usually do | Reported to [`onError`](/guide/handling-errors/#reporting-errors-with-onerror)? |
| ------ | ------------- | -------- | ------------------- | ---------------------- |
| `'http'` | The server answered with a non-2xx status. | The response's status | Handle it by status, or show it | Yes |
| `'network'` | No response arrived, because you're offline or DNS or CORS failed. Params liaise refuses before sending also land here. | `0` | Show an offline message, or retry | Yes |
| `'timeout'` | Your [`timeout`](/guide/cancelling-deadlines-and-stale-requests/#set-a-deadline-with-timeout) passed. | `0` | Say it's slow | Yes |
| `'abort'` | The call was cancelled by your signal, or replaced by a newer [`dedupe`](/guide/cancelling-deadlines-and-stale-requests/#drop-stale-calls-with-dedupe) call. | `0` | Ignore it | **No** |
| `'parse'` | A 2xx body didn't parse as its `responseType`, or failed your [schema](/guide/validating-responses/). | The response's status | Report it | Yes |
| `'middleware'` | Your middleware threw. | `0` | Fix your code | Yes |

- **Check `error` first.** After `if (error) return`, `data` has your response type, so you never write `data!`.
- For an endpoint that sends no body, declare `responseType: 'none'`. Widening the type to `| null` doesn't work, because an empty body is a `'parse'` error. See [Reading responses](/guide/reading-responses/).
- **Branch on `error.kind`.** Four kinds share `status: 0`, and each needs different handling.
- **A non-2xx response is always `'http'`**, even when its body doesn't parse. liaise checks the status before it reads the body, so a 500 with broken JSON is still a 500, and [`retryMiddleware`](/guide/retries-caching-and-logging/#retry-failed-calls) still retries it.
- **`response` is for the status and headers.** liaise has already read its body to produce `data` or `error.body`, so `response.json()` throws "Body has already been read". A `Response` you build yourself for `successResult()` in tests keeps its body.
- Every field of `error` is listed under [`ApiError`](/reference/result-and-apierror/).

## Trying again with retry()

Every `Result` carries `retry()`, which runs the same call again. It goes through all your middleware, so an auth header is set again and logging runs again:

```ts
const { error, retry } = await api.getUser({ id: '42' })

if (error?.status === 401) {
  await refreshToken()
  const second = await retry() // a fresh call through every middleware
  if (!second.error) show(second.data.name)
}
```

`refreshToken` stands for your own token refresh.

## Reporting errors with onError

`onError` on `createApi` is one place to send every error to your tracker.

```ts
const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUser },
  onError: (error) => logToTracker(error),
})
```

`logToTracker` stands for your error tracker, such as Sentry.

- It runs once per call, after all your middleware has finished. A call that a retry middleware rescues from a 500 never reaches it. When calls [share](/guide/sharing-identical-requests/) one failed request, it runs once for all of them.
- It isn't called for `'abort'`, because a cancellation isn't a failure. A `'timeout'` is reported, because it's a deadline you missed.
- It only watches. The caller gets the same `Result` either way.
