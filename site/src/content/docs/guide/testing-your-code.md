---
title: "Testing your code"
order: 12
---
`liaise/testing` gives you a `fetch` stub that matches routes. Your tests then run the real pipeline, from URL building, headers and body to parsing and your own middleware. A stubbed API method that returns a canned `Result` drifts away from what liaise actually does. The stub needs no test runner, so it works in Vitest, Jest or anything else.

```ts
import { mockFetch, jsonResponse } from 'liaise/testing'

const mock = mockFetch({
  'GET /api/users/:id': ({ params }) => jsonResponse({ id: params.id, name: 'Ada' }),
  'POST /api/users': jsonResponse({ id: 'new-user' }, { status: 201 }),
})

mock.install()   // replaces globalThis.fetch
// ... exercise your code, which calls the real api.getUser(...) ...
mock.restore()   // puts the original globalThis.fetch back
```

- **Routes are keyed as `"METHOD /path"`.** Each `:token` segment is captured and passed to a route function as `{ params, request }`.
- **A route value is a `Response`, a route function, or an array of either.** `jsonResponse` builds a `Response` with a JSON body, or you can build your own.
- **An array is a sequence.** Each matching call takes the next entry, and the last entry repeats once the others are used up. That suits "fail twice, then succeed":

  ```ts
  const mock = mockFetch({
    'GET /api/flaky': [jsonResponse(null, { status: 503 }), jsonResponse({ ok: true })],
  })
  ```

- **`mock.calls` records every request** as `{ method, url, headers, body }`. `mock.callCount('GET /api/users/:id')` and `mock.lastCall(...)` take the same `"METHOD /path"` keys as the routes.

## Unmatched routes

A request that matches no route makes the stub throw, so a typo in a path can't pass quietly. liaise catches every `fetch` rejection, so your code sees an ordinary `Result` with `kind: 'network'` and the `Error` in `error.body`. Its message names the method, the URL and every route you defined. Assert on the result, because the call itself never rejects.

```ts
const r = await api.getUser({ id: '42' })   // routes only define 'GET /api/user/:id'
expect(r.error?.kind).toBe('network')
expect(String(r.error?.body)).toMatch(/no route matched GET \/api\/users\/42/)
```

`api` is a client created with `baseUrl: '/api'`.

An empty array for a route behaves the same way, with a descriptive `Error` in `error.body`.

## Stubbing a Result directly

To stub at the `Result` level instead of the `fetch` level, `successResult(data)` and `errorResult(status, body)` build a well-formed `Result`. This uses Vitest's `vi.spyOn`, and any runner's equivalent works the same way:

```ts
import { successResult, errorResult } from 'liaise/testing'

vi.spyOn(api, 'getUser').mockResolvedValue(successResult({ id: '42', name: 'Ada' }))
vi.spyOn(api, 'getUser').mockResolvedValue(errorResult(404, { message: 'not found' }))
```

More of the stub's behaviour, such as how it handles a signal, is under [liaise/testing](/reference/liaisetesting/).
