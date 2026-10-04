# liaise

*lee-AYZ* — to act as the link between two parties.

**Your API calls, minus the surprises.**

Type-safe REST and GraphQL on plain fetch. Never throws. Zero dependencies. Works with any framework.

[![npm](https://img.shields.io/npm/v/liaise)](https://www.npmjs.com/package/liaise) [![CI](https://github.com/iremlopsum/liaise/actions/workflows/ci.yml/badge.svg)](https://github.com/iremlopsum/liaise/actions/workflows/ci.yml) ![5.8 kB gzipped](https://img.shields.io/badge/gzipped-5.8%20kB-blue) ![MIT](https://img.shields.io/badge/license-MIT-blue)

```bash
npm install liaise
```

Formerly published as `@iremlopsum/apify`; switching takes two steps, see [MIGRATION.md](./MIGRATION.md#upgrading-to-500).

**Contents**

- [The problem it solves](#the-problem-it-solves)
- [Quick start](#quick-start)
- [How it fits together](#how-it-fits-together)
- [Guide](#guide)
  - [Defining endpoints](#defining-endpoints)
  - [Handling errors](#handling-errors)
  - [Sending data](#sending-data)
  - [Reading responses](#reading-responses)
  - [Validating responses](#validating-responses)
  - [Cancelling, deadlines and stale requests](#cancelling-deadlines-and-stale-requests)
  - [Sharing identical requests](#sharing-identical-requests)
  - [Retries, caching and logging](#retries-caching-and-logging)
  - [Writing middleware](#writing-middleware)
  - [Pagination](#pagination)
  - [GraphQL](#graphql)
  - [Testing your code](#testing-your-code)
- [Recipes](#recipes)
  - [Add an auth header and refresh the token on a 401](#add-an-auth-header-and-refresh-the-token-on-a-401)
  - [Search as you type](#search-as-you-type)
  - [Use with TanStack Query](#use-with-tanstack-query)
  - [Use with React](#use-with-react)
  - [Load the current user into a store](#load-the-current-user-into-a-store)
  - [One /me per page view on the server](#one-me-per-page-view-on-the-server)
  - [Retry a flaky backend within one deadline](#retry-a-flaky-backend-within-one-deadline)
  - [Give each attempt its own timeout](#give-each-attempt-its-own-timeout)
  - [Report errors to Sentry](#report-errors-to-sentry)
  - [Upload and download files](#upload-and-download-files)
- [Philosophy](#philosophy)
- [API Reference](#api-reference)
- [Contributing](#contributing)
- [License](#license)

## The problem it solves

`fetch` is a good building block. Every project still ends up writing the same few things around it, and they are easy to get subtly wrong.

| With plain fetch | liaise | See |
| ---------------- | ------ | --- |
| Typing fast in a search box shows old results. A slow early search lands last. | `dedupe` cancels the older call. | [Stale requests](#cancelling-deadlines-and-stale-requests) |
| Five components load the same data, or five 401s each refresh the token. That's five identical requests. | `share` sends one and hands everyone the answer. | [Sharing identical requests](#sharing-identical-requests) |
| A 500 counts as success, offline throws, a hung server waits forever. | Every call returns `{ data, error }`. `error.kind` names the failure. | [Handling errors](#handling-errors) |
| Retries run straight past your timeout. | `timeout` covers the whole operation, retries included. | [Deadlines](#cancelling-deadlines-and-stale-requests) |
| The backend changes a field and the page crashes three components later. | A schema checks the response. A bad shape is an error you handle. | [Validating responses](#validating-responses) |

### Before and after

Here is one form submit, written both ways. `show` stands for whatever puts a message on screen.

**With plain fetch**

```ts
try {
  const res = await fetch('/api/orders', { method: 'POST', body: JSON.stringify(order) })
  show(`Order ${(await res.json()).id} confirmed`) // a 500 lands here too
} catch {
  show('Something went wrong') // offline? broken JSON? no way to tell
}
```

**With liaise**

<!-- tested: problem-after -->
```ts
async function submit(order: { items: string[] }) {
  const { data, error } = await api.placeOrder(order)
  if (!error) return show(`Order ${data.id} confirmed`)

  switch (error.kind) {
    case 'http':    return show(`The server said no (${error.status})`)
    case 'network': return show("You're offline. We'll try again.")
    case 'timeout': return show('This is taking too long. Try again.')
    case 'parse':   return show('The server sent something unexpected.')
  }
}
```

`api.placeOrder` is an endpoint defined like the ones in [Quick start](#quick-start), with `timeout: 5000` so a hung server gives up after five seconds.

The `switch` leaves out `'abort'`, because nothing here cancels a call, and `'middleware'`, which points at a bug in your own code ([all six kinds](#handling-errors)).

### Why another API client?

Without it, you have two options. You can hand-roll a wrapper around fetch, which means writing the same boilerplate on every project: a typed function per endpoint, status checks, error handling, retries, cancellation.

Or you can reach for a large library like Apollo or urql. They're built for very large apps with complex data needs. For most products, that's bringing a tank to a chess match, and you spend hours on setup and configuration for features you never use.

liaise sits in between. It's the wrapper you'd otherwise hand-roll, already written and tested. Your whole setup is a base URL and your endpoints.

**The API client you'd build on your third project, with the edge cases already handled.**

## Quick start

Define two endpoints, create a client, and make a call.

<!-- tested: quick-start -->
```ts
import { createApi, defineRequest } from 'liaise'

type User = { id: string; name: string; email: string }

// 1. Describe your endpoints. The path decides which params are required.
const getUser = defineRequest<User>()({ method: 'GET', path: '/users/:id' })
const createUser = defineRequest<User, { name: string; email: string }>()({
  method: 'POST',
  path: '/users',
})

// 2. Create the client.
const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUser, createUser },
})

// 3. Call it. This never throws: you always get { data, error }.
const { data, error } = await api.getUser({ id: '42' })

if (error) {
  // error.kind says what went wrong: 'http', 'network', 'timeout', ...
  console.error(error.kind, error.status)
} else {
  console.log(data.name) // data is a User here
}
```

### What you just got

- The params are checked against the path, so `getUser({ userId: '42' })` is a compile error.
- `data` is typed from `defineRequest<User>`.
- Nothing throws, not even when you're offline.
- Checking `error` first narrows `data` to `User`, so you never write `data!`.

### Next

- [Handling errors](#handling-errors)
- [Add an auth header and refresh the token on a 401](#add-an-auth-header-and-refresh-the-token-on-a-401)
- [Use with TanStack Query](#use-with-tanstack-query)
- [Use with React](#use-with-react)

## How it fits together

liaise has four pieces, and every call takes the same path through them. Middleware is a function that wraps a call, so it can add a header, retry or log.

### Four pieces

| Piece | What it is |
| ----- | ---------- |
| Endpoint definition (`defineRequest`) | A recipe for one endpoint: its method, its path and the types of its params and response. It does nothing on its own. |
| Client (`createApi`) | Turns your recipes into typed functions, one per endpoint. |
| Call | `api.getUser(params, options)`, where `options` can set `signal`, `timeout`, `headers` or `middleware` for this call only. |
| `Result` | `{ data, error, response, retry }`, which is what every call returns. `data` and `error` are never both set. `retry()` runs the same call again. |

Types flow from the endpoint definition through `createApi` to every call, so you never annotate a call. When you need a type by name, it is listed under [Type exports](#type-exports).

### The path of one call

```text
params → URL + body → your middleware → fetch → parse → validate → Result
```

Any step can fail, and the failure lands in `error` instead of being thrown.

### Three levels of settings

You can write a setting in three places: on the client, on the endpoint, or on one call. For headers, the most specific one wins. For middleware, every level runs, the client's first.

| Level | Where you write it | `headers` | `middleware` |
| ----- | ------------------ | --------- | ------------ |
| Client | `createApi({ headers, middleware })` | Sent with every call | Runs first, around everything else |
| Endpoint | `defineRequest<T>()({ headers, middleware })` | Replaces the client's value for the same header | Runs second |
| Call | `api.getUser(params, { headers, middleware })` | Replaces the client's and the endpoint's value for the same header | Runs last, closest to `fetch` |

Headers merge by name, so setting one header on a call keeps every other header from the client and the endpoint. A `Content-Type` you set at any level replaces the one liaise picks from the body.

```ts
import { createApi, defineRequest } from 'liaise'

type Report = { total: number }

const api = createApi({
  baseUrl: 'https://api.example.com',
  headers: { 'x-api-version': '1' }, // every call
  requests: {
    getReport: defineRequest<Report>()({
      method: 'GET',
      path: '/report',
      headers: { 'x-api-version': '2' }, // this endpoint: replaces the client's
    }),
  },
})

await api.getReport() // sends x-api-version: 2
await api.getReport({}, { headers: { 'x-api-version': '3' } }) // sends x-api-version: 3
```

### Type exports

```ts
import type {
  Result,
  CallOptions,
  Middleware,
  MiddlewareContext,
  MiddlewareNext,
  RequestConfig,
  ApiConfig
} from 'liaise'
```

## Guide

Each section starts with the problem it solves, then shows the smallest example, then lists the rules.

### Defining endpoints

You describe each endpoint once, with its method, its path, and the types of its params and response. Every call to it is then checked against that description.

```ts
import { createApi, defineRequest } from 'liaise'

type Repo = { id: number; name: string }

// The first type is the response. The second is the params the path doesn't name.
const listRepos = defineRequest<Repo[], { page?: number }>()({
  method: 'GET',
  path: '/orgs/:org/repos',
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { listRepos } })

await api.listRepos({ org: 'acme' })           // GET /orgs/acme/repos
await api.listRepos({ org: 'acme', page: 2 })  // GET /orgs/acme/repos?page=2
await api.listRepos({ page: 2 })               // ✗ compile error: org is required
```

- **The path names the required params.** Each `:name` in the path becomes a required param of type `string | number`. Its value is filled into the URL and left out of the query string and the body.
- **Every other param goes in the second type argument.** For `GET` and `DELETE`, these params go in the query string. For `POST`, `PUT` and `PATCH`, they go in a JSON body. [Sending data](#sending-data) covers what each one can hold.
- **`bodyAs` flips that default.** Use it for an API that does it the other way round:

  ```ts
  type Job = { id: string }

  // A DELETE that takes a JSON body
  const bulkDelete = defineRequest<{ deleted: number }, { ids: string[] }>()({
    method: 'DELETE',
    path: '/items',
    bodyAs: 'body',
  })

  // A POST that sends its params in the query string
  const triggerJob = defineRequest<Job, { priority: number }>()({
    method: 'POST',
    path: '/jobs/trigger',
    bodyAs: 'query',
  })
  ```

- **A path param must have a usable value.** It must be a non-empty string, a finite number, a bigint or a boolean. `undefined`, `null`, `''`, an object, an array, a `Date` and `NaN` are refused before anything is sent, with an error naming the param.
- That catches the most common mistake, which is calling before an id has loaded. An `org` that is still `undefined` at runtime returns an error instead of fetching `/orgs/undefined/repos`.
- **An endpoint with no params** is called with no arguments. With `defineRequest<{ status: string }>()({ method: 'GET', path: '/health' })`, both `api.health()` and `api.health({})` work.
- **`responseType`** says how to read the response body. It defaults to `'json'`. The options are under [Reading responses](#reading-responses).
- **`responseType: 'none'` needs the response type `undefined`.** Anything else is a compile error, because `data` is always `undefined` for an endpoint that sends no body:

  ```ts
  defineRequest<undefined>()({ method: 'POST', path: '/ping', responseType: 'none' })  // ✓
  defineRequest<Repo>()({ method: 'POST', path: '/ping', responseType: 'none' })       // ✗
  ```

- **A `#` in the path is a compile error.** A URL fragment is never sent to the server, so `path: '/docs#section'` is refused where you write it. [URL fragments](#url-fragments) has the details.

**Why two calls.** `defineRequest<Repo[]>()({ ... })` is two calls because TypeScript can't infer some type arguments while you write others. The first call takes the response type you write, and the second infers the params from the path. In a single call, writing the response type would quietly turn the path checking off.

#### Without defineRequest

`new Request<TParams, TResponse>(config)` is the class that `defineRequest` builds. You write the params type yourself, covering path, query and body params together, and nothing checks it against the path:

```ts
import { createApi, Request } from 'liaise'

type User = { id: string; name: string }

const getUser = new Request<{ userId: string }, User>({ method: 'GET', path: '/users/:id' })
const api = createApi({ baseUrl: 'https://api.example.com', requests: { getUser } })

await api.getUser({ userId: '42' })
// Compiles. The call then returns an error, because the path has no :userId and :id is never filled in.
```

Use `new Request` when the config isn't a literal, for example when you build it at runtime, or when you don't want the path checked. It is not deprecated. For an endpoint with no params, write `Record<string, never>` as `TParams`.

### Handling errors

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

| `kind` | What happened | `status` | What you usually do | Reported to [`onError`](#reporting-errors-with-onerror)? |
| ------ | ------------- | -------- | ------------------- | ---------------------- |
| `'http'` | The server answered with a non-2xx status. | The response's status | Handle it by status, or show it | Yes |
| `'network'` | No response arrived, because you're offline or DNS or CORS failed. Params liaise refuses before sending also land here. | `0` | Show an offline message, or retry | Yes |
| `'timeout'` | Your [`timeout`](#set-a-deadline-with-timeout) passed. | `0` | Say it's slow | Yes |
| `'abort'` | The call was cancelled by your signal, or replaced by a newer [`dedupe`](#drop-stale-calls-with-dedupe) call. | `0` | Ignore it | **No** |
| `'parse'` | A 2xx body didn't parse as its `responseType`, or failed your [schema](#validating-responses). | The response's status | Report it | Yes |
| `'middleware'` | Your middleware threw. | `0` | Fix your code | Yes |

- **Check `error` first.** After `if (error) return`, `data` has your response type, so you never write `data!`.
- For an endpoint that sends no body, declare `responseType: 'none'`. Widening the type to `| null` doesn't work, because an empty body is a `'parse'` error. See [Reading responses](#reading-responses).
- **Branch on `error.kind`.** Four kinds share `status: 0`, and each needs different handling.
- **A non-2xx response is always `'http'`**, even when its body doesn't parse. liaise checks the status before it reads the body, so a 500 with broken JSON is still a 500, and [`retryMiddleware`](#retries-caching-and-logging) still retries it.
- **`response` is for the status and headers.** liaise has already read its body to produce `data` or `error.body`, so `response.json()` throws "Body has already been read". A `Response` you build yourself for `successResult()` in tests keeps its body.
- Every field of `error` is listed under [`ApiError`](#apierror).

#### Trying again with retry()

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

#### Reporting errors with onError

`onError` on `createApi` is one place to send every error to your tracker.

```ts
const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUser },
  onError: (error) => logToTracker(error),
})
```

`logToTracker` stands for your error tracker, such as Sentry.

- It runs once per call, after all your middleware has finished. A call that a retry middleware rescues from a 500 never reaches it.
- It isn't called for `'abort'`, because a cancellation isn't a failure. A `'timeout'` is reported, because it's a deadline you missed.
- It only watches. The caller gets the same `Result` either way.

### Sending data

You pass one params object, and liaise puts each field where it belongs: in the path, the query string or the body. You never build a URL by hand.

```ts
import { createApi, defineRequest } from 'liaise'

type Item = { id: string; name: string }

const listItems = defineRequest<Item[], { page: number; tags: string[] }>()({
  method: 'GET',
  path: '/orgs/:org/items',
})
const createItem = defineRequest<Item, { name: string }>()({
  method: 'POST',
  path: '/orgs/:org/items',
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { listItems, createItem } })

await api.listItems({ org: 'acme', page: 2, tags: ['a', 'b'] })
// GET /orgs/acme/items?page=2&tags=a&tags=b

await api.createItem({ org: 'acme', name: 'Lamp' })
// POST /orgs/acme/items, with the JSON body {"name":"Lamp"}
```

Which params go in the query string and which in the body is set per endpoint, under [Defining endpoints](#defining-endpoints).

#### Query strings

| Params | Query string |
| ------ | ------------ |
| `{ page: 1, limit: 20 }` | `?page=1&limit=20` |
| `{ tags: ['a', 'b'] }` | `?tags=a&tags=b` |
| `{ filter: null }` | _(left out)_ |
| `{ filter: undefined }` | _(left out)_ |
| `{ meta: { nested: true } }` | Refused |
| `{ since: new Date() }` | Refused |

- **Arrays** become repeated keys (`tags=a&tags=b`), the format most server frameworks read.
- **`null` and `undefined`** are left out.
- **A nested object is refused.** There is no standard way to put one in a query string (brackets, dots and JSON are all in use), so liaise doesn't guess. Flatten it first.
- **A `Date` is refused too.** APIs expect ISO 8601 or epoch milliseconds, so convert it yourself with `date.toISOString()` or `date.getTime()`.
- A refused param sends nothing. You get an error `Result` with `kind: 'network'` and a `TypeError` in `error.body` that names the param.

#### Request bodies

liaise serializes the body from what you pass, and sets `Content-Type` for you unless you set one yourself.

| You pass | Body sent | Content-Type |
| -------- | --------- | ------------ |
| `null`/`undefined` | `null` | _(none)_ |
| `string` | as-is | `text/plain` |
| `FormData` | as-is | _(the browser sets the multipart boundary)_ |
| `URLSearchParams` | as-is | `application/x-www-form-urlencoded` |
| `Blob` | as-is | `application/octet-stream` |
| `ArrayBuffer` | as-is | `application/octet-stream` |
| Typed array, `DataView`, `Buffer` | as-is (sent as binary) | `application/octet-stream` |
| `ReadableStream` | as-is (a streaming upload; `duplex: 'half'` is set for you) | `application/octet-stream` |
| Plain object | `JSON.stringify()` | `application/json` |

A `ReadableStream` body can be sent only once. A retry, from middleware or from `result.retry()`, returns an error telling you to read the stream into a `Blob` or `ArrayBuffer` first ([details](#stream-bodies)).

#### What params can be

| You pass | What happens |
| -------- | ------------ |
| Plain object | Split into path params, query string and body |
| `Map` with string keys | Same as the object it spells |
| Class instance with fields | Same as a plain object (split by those fields even if the class also defines `toJSON()`; `toJSON()` is used only when there are no own fields) |
| Class instance with only `toJSON()` | Sent as its JSON (body only; refused on a request whose params go in the query string) |
| Typed array, `DataView`, `Buffer`, `ReadableStream` | Sent as the body, as in the table above (refused on a request whose params go in the query string) |
| `Set`, a bare `Date`, a `Map` with non-string keys, a class with no fields | Refused: an error `Result` (`kind: 'network'`) naming the type. Nothing is sent. |

A `Map`, `Set` or class with private state nested inside a JSON body is sent as `{}`, because that is what `JSON.stringify` does. Convert it first.

Headers, including your own `Content-Type`, follow the [three levels of settings](#three-levels-of-settings).

### Reading responses

A response can be JSON, text or a file. You say which with `responseType`, and liaise reads the body for you.

```ts
import { createApi, defineRequest } from 'liaise'

type User = { id: string; name: string }

// JSON is the default.
const getUser = defineRequest<User>()({ method: 'GET', path: '/users/:id' })

// A file comes back as a Blob.
const downloadFile = defineRequest<Blob>()({ method: 'GET', path: '/files/:id', responseType: 'blob' })

// A 204 No Content has no body, so data is undefined.
const deleteUser = defineRequest<undefined>()({
  method: 'DELETE',
  path: '/users/:id',
  responseType: 'none',
})

const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUser, downloadFile, deleteUser },
})
```

| `responseType` | How the body is read | `data` |
| -------------- | -------------------- | ------ |
| `'json'` (default) | `response.text()`, then `JSON.parse()` | the parsed value |
| `'text'` | `response.text()` | `string` |
| `'blob'` | `response.blob()` | `Blob` |
| `'arrayBuffer'` | `response.arrayBuffer()` | `ArrayBuffer` |
| `'formData'` | `response.formData()` | `FormData` |
| `'none'` | not read (the stream is cancelled) | `undefined` |

- **An empty body under `'json'` is a `'parse'` error.** You declared JSON and the server sent none, so no value could honestly match your type. The error has the response's own status (a 204 reports 204), the `response`, and `''` in `error.body`.
- **A literal `null` body is not empty.** It is valid JSON, so the call succeeds with `data: null`.
- **`'none'` is for an endpoint that sends no body on success**, such as a `DELETE` that answers 204, or 200 with an empty body. liaise reads nothing, `data` is `undefined`, and a body the server sends anyway is discarded. Its stream is cancelled, which frees the connection.
- **Declare `'none'` with the response type `undefined`.** `defineRequest` enforces this ([Defining endpoints](#defining-endpoints)). With `new Request` it is only a convention, and `data` is `undefined` at runtime whatever type you wrote.
- **A non-2xx body is still read into `error.body`**, because an error body usually explains what went wrong. Under `'none'` it is read as JSON, and `error.body` is `null` when it isn't JSON:

  ```ts
  const { error } = await api.deleteUser({ id: '42' })
  if (error) {
    // A 409 { "error": "already deleted" } lands in error.body,
    // even though deleteUser declares responseType: 'none'.
    console.error(error.status, error.body)
  }
  ```

### Validating responses

TypeScript trusts the type you write, and nothing checks it at runtime. When the backend changes a field, the page crashes three components later. Give the endpoint a schema, and the response is checked before you see it.

```ts
import { createApi, defineRequest } from 'liaise'
import { z } from 'zod'

const getUser = defineRequest()({
  method: 'GET',
  path: '/users/:id',
  schema: z.object({ id: z.string(), name: z.string() }),
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { getUser } })

const { data, error } = await api.getUser({ id: '42' })
//      ^? { id: string; name: string } | null
```

Valibot and ArkType work the same way:

```ts
import * as v from 'valibot'
import { type } from 'arktype'

const withValibot = defineRequest()({
  method: 'GET',
  path: '/users/:id',
  schema: v.object({ id: v.string(), name: v.string() }),
})

const withArkType = defineRequest()({
  method: 'GET',
  path: '/users/:id',
  schema: type({ id: 'string', name: 'string' }),
})
```

- **Any [Standard Schema](https://standardschema.dev) validator works.** liaise doesn't depend on any of them. Standard Schema is only an interface, so you bring the validator you already use.
- **The schema supplies the response type.** You write no type argument, so there's no second type to keep in sync.
- **`data` is the schema's output.** A schema that transforms changes what you receive, so `data` can differ from the raw response:

  ```ts
  const getUser = defineRequest()({
    method: 'GET',
    path: '/users/:id',
    schema: z.object({
      id: z.string(),
      createdAt: z.coerce.date(),        // the wire sends a string
      role: z.string().default('user'),  // absent on the wire
    }),
  })

  const { data } = await api.getUser({ id: '42' })
  data.createdAt   // a real Date
  data.role        // 'user' when the server left it out
  ```

- **A response the schema refuses is a `'parse'` error.** Nothing is thrown. `error.body` holds the validator's issues, and `error.status` is the response's own status, since the server answered fine:

  ```ts
  const { error } = await api.getUser({ id: '42' })
  if (error?.kind === 'parse') {
    console.error(error.body)  // the validator's issues
  }
  ```

- A validator that throws is a `'parse'` error too, with the thrown value in `error.body`.
- **Only a 2xx body is validated.** A non-2xx body is diagnostic and often a different shape, so it is left alone.
- **The GraphQL `Operation` takes `schema` too**, and validates the response's `data`. There the response type stays explicit, because only `defineRequest` infers it:

  ```ts
  import { Operation, gql } from 'liaise'

  const UserSchema = z.object({ id: z.string(), name: z.string() })

  const me = new Operation<Record<string, never>, z.infer<typeof UserSchema>>({
    operation: gql`query { me { id name } }`,
    schema: UserSchema,
  })
  ```

### Cancelling, deadlines and stale requests

Sometimes you no longer need a call, because the user left the page or typed a newer search. Sometimes a call takes too long. You can end a call with a signal, a deadline, or `dedupe`, and each one ends it with an error you can tell apart.

#### Cancel with a signal

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

A cancellation you asked for isn't reported to [`onError`](#reporting-errors-with-onerror). How liaise tells your cancellation apart from other failures is under [Abort classification](#abort-classification).

#### Set a deadline with timeout

`timeout` is in milliseconds, and you set it on the endpoint or on one call:

```ts
import { createApi, defineRequest } from 'liaise'
import { retryMiddleware } from 'liaise/middleware'

type Report = { total: number }

const getReport = defineRequest<Report>()({ method: 'GET', path: '/report', timeout: 3000 })

const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getReport },
  middleware: [retryMiddleware(3)],
})

const { error } = await api.getReport()
// If no answer arrives within 3 seconds, retries included: error.kind === 'timeout', error.status === 0
```

- **`timeout` is one deadline for the whole call.** It covers every middleware, every retry and every wait between retries. `timeout: 3000` with three retries still answers within three seconds.
- **A call's `timeout` replaces the endpoint's.** `timeout: 0` on a call turns the endpoint's deadline off. Zero, a negative number or no `timeout` at all means no deadline, which is the default.
- **`result.retry()` starts a fresh deadline.** The retried call isn't charged for time the first one used.
- If you want a separate limit for each attempt instead, see [Give each attempt its own timeout](#give-each-attempt-its-own-timeout).
- Under [`share`](#sharing-identical-requests), the endpoint's `timeout` belongs to the one shared request, and a caller can't extend it.

#### Drop stale calls with dedupe

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
- It can't be combined with [`share`](#sharing-identical-requests), which does the opposite.

All three still end the call when a middleware is stuck on work of its own that ignores the signal, such as a token refresh that never settles. [Timeout backstop](#timeout-backstop) explains how.

### Sharing identical requests

Several parts of an app often ask for the same thing at the same moment. Five components load the current user, or five calls get a 401 and each one refreshes the token. `share: true` sends one request and gives every caller its answer.

```ts
import { createApi, defineRequest } from 'liaise'

type Product = { id: string; name: string }

const getProduct = defineRequest<Product>()({
  method: 'GET',
  path: '/products/:id',
  share: true,
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { getProduct } })

// One network request. Both callers get the same response.
const [a, b] = await Promise.all([
  api.getProduct({ id: '42' }),
  api.getProduct({ id: '42' }),
])
```

- **`share` joins the call already running. [`dedupe`](#drop-stale-calls-with-dedupe) cancels it.** Setting both on one endpoint throws when you create the client, so you find the mistake straight away.
- **Identical means the same endpoint and the same params, compared by content.** Key order doesn't matter, and two `Date`s with the same time match. Different params or a different endpoint never share. [Share key and refcount](#share-key-and-refcount) has the full rules.
- **A per-call `headers` or `middleware` turns sharing off for that call.** Either one can change what is requested, so that call gets a request of its own.
- **Params that can't be compared safely turn sharing off too.** These are a BigInt, an `ArrayBuffer`, `Blob`, `FormData` or `URLSearchParams`, a circular structure, and an object with no enumerable state, such as an `Error` or a class instance that keeps its state in private fields, at any depth. Two different values of those kinds could look the same, so that call gets its own request.
- **A `Date`, `Map`, `Set`, typed array or string param shares normally.**
- **A per-call `signal` or `timeout` only lets that caller leave.** The caller that gives up gets `kind: 'abort'` or `'timeout'`, reported to [`onError`](#reporting-errors-with-onerror) as an unshared call would be. The request keeps running for the others, and is cancelled once every caller has given up.
- **The endpoint's own `timeout` bounds the shared request for everyone.** It counts from when the request started. A caller that joins late can't extend it, and `timeout: 0` on one call can't turn it off.

```ts
const impatient = api.getProduct({ id: '42' }, { timeout: 20 }) // gives up quickly
const patient = api.getProduct({ id: '42' })                    // keeps waiting

// impatient's timeout doesn't cancel the shared request, so patient still gets the response.
```

Two rarer cases have their own notes: [`retry()` on a shared result](#retry-on-a-shared-result) and [middleware that replaces the signal](#signal-replacing-middleware).

#### On a server

Sharing is decided before middleware runs. A header that a middleware adds, such as the current user's token, is not part of the match. With one client serving every user, one user's call can join another user's call and receive that user's response.

Create one client per incoming request, as in [One /me per page view on the server](#one-me-per-page-view-on-the-server). Otherwise, don't set `share` on an endpoint whose answer depends on who is asking.

### Retries, caching and logging

Some failures go away when you try again. Some reads repeat often enough to keep. And while you build, you want to see every call. liaise ships a middleware for each, in a separate entry point:

```ts
import { retryMiddleware, cacheMiddleware, logMiddleware } from 'liaise/middleware'
```

#### Retry failed calls

`retryMiddleware(2)` retries a failed call up to two more times, three attempts in all. By default it retries only 5xx responses. Any 4xx, including a 429, comes back as it is, and so does a network error. To retry 429s and network errors too, pass `retryOn`:

```ts
import { createApi, defineRequest } from 'liaise'
import { retryMiddleware } from 'liaise/middleware'

type Item = { id: string }

const getItems = defineRequest<Item[]>()({ method: 'GET', path: '/items' })

const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getItems },
  middleware: [retryMiddleware(2)], // 5xx only
})

// Also retry 429 and network errors. An abort has status 0 too, so check kind.
const retryMore = retryMiddleware({
  retryOn: (r) =>
    (r.error?.status ?? 0) >= 500 || r.error?.status === 429 || r.error?.kind === 'network',
})
```

Pass an object to tune the waits between attempts:

```ts
const retry = retryMiddleware({
  max: 5,               // up to 5 retries after the first attempt
  delay: 'exponential', // 250 ms, 500 ms, 1 s, ... before jitter
  onRetry: ({ attempt, max, delay }) => console.log(`retry ${attempt}/${max} in ${delay}ms`),
})
```

- By default the waits grow exponentially with random jitter, and a `Retry-After` header from the server is honoured. Every option is in [RetryOptions](#retryoptions).
- **A cancel or a deadline during a wait ends the call with that error.** If your `timeout`, your signal or a newer `dedupe` call fires between attempts, you get `kind: 'timeout'` or `'abort'`. The 503 that caused the retry is dropped.

#### Cache repeated reads

`cacheMiddleware()` keeps successful responses in memory, so a repeated read within the time-to-live skips the network. Each `cacheMiddleware()` call makes its own store. Give it to the endpoints you want cached:

```ts
import { createApi, defineRequest } from 'liaise'
import { cacheMiddleware } from 'liaise/middleware'

type User = { id: string; name: string }

const getUserCache = cacheMiddleware({ ttl: 5 * 60_000, maxSize: 100 })

const getUser = defineRequest<User>()({
  method: 'GET',
  path: '/users/:id',
  middleware: [getUserCache],
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { getUser } })

// On logout, clear every cached entry:
getUserCache.clear()

// Skip the cache for one call:
const { data } = await api.getUser({ id: '42' }, { skipMiddleware: [getUserCache] })
```

- **Only successes are cached.** An error always goes to the network again.
- **The key includes the URL, the params and the headers.** When your auth header is set before the cache runs, one user never sees another user's entry. [Cache key](#cache-key) has the details.
- **Put a middleware that adds a unique header to each call after `cacheMiddleware`.** A request ID added before it makes every call look new, and nothing is ever cached. Client middleware always runs before endpoint middleware, so either list the request-ID middleware on the endpoint after the cache, or put the cache on the client before it.
- The options are `ttl` in milliseconds (default 5 minutes), `maxSize` in entries (default 50), and `debug`, which logs hits and misses to the console (default `false`).

#### Log every call

`logMiddleware` prints each call's start and end to the console, with its duration:

```text
[liaise] → GET getItems /api/items
[liaise] ← getItems OK (142ms)

[liaise] → POST createUser /api/users
[liaise] ← createUser ERROR 422 (89ms)
```

```ts
import { createApi, defineRequest } from 'liaise'
import { logMiddleware } from 'liaise/middleware'

const getItems = defineRequest<{ id: string }[]>()({ method: 'GET', path: '/items' })

const api = createApi({ baseUrl: '/api', requests: { getItems }, middleware: [logMiddleware] })
```

It is meant for development. In production, [write a middleware](#writing-middleware) that sends the same facts to your monitoring.

### Writing middleware

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

Middleware runs at three levels, the client's first and the call's last, as [Three levels of settings](#three-levels-of-settings) shows.

#### Skipping a middleware for one call

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

#### What a middleware sees

`ctx.requestName` is the endpoint's key, such as `'getUser'`. `ctx.request` holds the request as it will be sent:

- `method`, and `url` with the path params and query string filled in
- `path`, the template, such as `/users/:id`
- `params`, as the caller passed them
- `headers`, a `Headers` object you can change
- `body`, already serialized, or `null` when there is none
- `signal`, the `AbortSignal` that `fetch` receives

The types are under [MiddlewareContext](#middlewarecontext).

#### Signals in middleware

`ctx.request.signal` combines the caller's `signal` with the call's `timeout`, and is `undefined` when there is neither. liaise reads it when it calls `fetch`, so a middleware can replace it:

```ts
import { createApi, defineRequest, type Middleware } from 'liaise'

type User = { id: string; name: string }

const getUser = defineRequest<User>()({ method: 'GET', path: '/users/:id' })

const timeout = (ms: number): Middleware => async (ctx, next) => {
  ctx.request.signal = AbortSignal.timeout(ms)
  return next()
}

const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUser },
  middleware: [timeout(5000)],
})
```

Your signal is then the only one `fetch` receives, so if the caller cancels, the call still ends with `kind: 'abort'` while the request itself runs on until your signal fires.

A newer call can still cancel this one under [`dedupe`](#drop-stale-calls-with-dedupe), because liaise adds that signal after your middleware runs.

**Pass `ctx.request.signal` on to async work your middleware does itself**, such as a token refresh, a lookup or a queue. liaise won't wait for that work past the deadline or the caller's cancel ([Timeout backstop](#timeout-backstop)). A promise can't be stopped from outside, so passing the signal is the only way to end the work. Without it, the work keeps running and its result is thrown away.

#### Example: report server errors

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

### Pagination

Many list endpoints return one page at a time. `paginate` walks through the pages and gives you one `Result` per page:

```ts
import { createApi, defineRequest, paginate } from 'liaise'

type Item = { id: string; name: string }
type Page = { items: Item[]; cursor?: string }

const listItems = defineRequest<Page, { limit: number; cursor?: string }>()({
  method: 'GET',
  path: '/items',
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { listItems } })

for await (const page of paginate(api.listItems, { limit: 50 }, {
  next: (p, prev) => (p.data.cursor ? { ...prev, cursor: p.data.cursor } : undefined),
})) {
  if (page.error) break
  render(page.data.items)
}
```

`render` stands for your own code.

- **`next` returns the params for the next page.** It gets the page just loaded and the params that loaded it, so the usual case is a spread. liaise never has to guess whether your API calls it `cursor`, `page_token` or `after`, and the same shape covers every scheme:

  ```ts
  // offset
  next: (p, prev) => p.data.items.length === prev.limit
    ? { ...prev, offset: prev.offset + prev.limit }
    : undefined

  // page number, driven by a Link header
  next: (p, prev) => p.response.headers.get('link')?.includes('rel="next"')
    ? { ...prev, page: prev.page + 1 }
    : undefined
  ```

- **Return `undefined` or `null` to stop.**
- **An error page ends the walk.** You get the error page, and then the loop ends, because there is no data to read the next cursor from. You see what failed. The loop never stops quietly.
- **`maxPages` has no default.** Set it if you want a ceiling, as in `paginate(api.listItems, { limit: 50 }, { next, maxPages: 100 })`. liaise doesn't pick a number, because a silent cut-off at an arbitrary page looks exactly like reaching the last one.
- **Every other option applies to every page.** Any of the [`CallOptions`](#reference-in-progress), such as `signal`, `timeout` or `headers`, goes with each request, so one signal cancels the whole walk.
- **`paginate` yields pages.** Read the items from each page yourself. Flattening them would mean guessing which field holds the array.

### GraphQL

`createGraphQL` is the client for a GraphQL backend. Its calls return the same `Result`, run the same middleware and report errors the same way. Every operation is sent as a POST with `{ query, variables }`.

```ts
import { createGraphQL, Operation, gql } from 'liaise'

type Category = { id: string; name: string; status: string }

const GET_CATEGORY = gql`
  query GetCategory($id: String!) {
    category(id: $id) {
      id
      name
      status
    }
  }
`

const getCategory = new Operation<{ id: string }, Category>({
  operation: GET_CATEGORY,
})

const graphql = createGraphQL({
  endpoint: 'https://api.example.com/graphql',
  operations: { getCategory },
  onError: (error) => console.error(error.status, error.body),
})

const { data, error, response, retry } = await graphql.getCategory({ id: '123' })
```

`Operation<TVariables, TData>` takes the variables type first and the response type second. `gql` marks the string as GraphQL for your editor.

An operation with no variables is called without arguments. Write `Record<string, never>` as its variables type:

```ts
type Viewer = { id: string; name: string }

const getViewer = new Operation<Record<string, never>, Viewer>({
  operation: gql`query { viewer { id name } }`,
})

const api = createGraphQL({ endpoint: 'https://api.example.com/graphql', operations: { getViewer } })

const { data } = await api.getViewer() // no arguments
```

#### Queries and mutations

To keep queries and mutations apart, use the `queries` and `mutations` keys instead of `operations`. Each client uses one shape or the other, and TypeScript refuses both together.

```ts
const graphql = createGraphQL({
  endpoint: 'https://api.example.com/graphql',
  queries: {
    getCategory: new Operation<{ id: string }, Category>({ operation: GET_CATEGORY }),
  },
  mutations: {
    updateCategory: new Operation<{ id: string; name: string }, Category>({
      operation: gql`
        mutation UpdateCategory($id: String!, $name: String!) {
          updateCategory(id: $id, name: $name) { id name status }
        }
      `,
    }),
  },
})

graphql.query.getCategory({ id: '123' })
graphql.mutation.updateCategory({ id: '123', name: 'New Name' })
```

#### GraphQL errors

A 2xx response with `{ errors: [...] }` is an error. It has `kind: 'http'`, the response's own `status`, and the `GraphQLError[]` in `error.body`. The same `if (error)` check covers GraphQL errors, HTTP errors and network errors.

GraphQL allows partial success, where one field fails and the rest of the query resolves. That data is kept in `error.partialData`. `result.data` stays `null` whenever `error` is set, so `Result` keeps its two clean branches.

```ts
const { error } = await graphql.getCategory({ id: '123' })
if (error) {
  console.log(error.body)        // GraphQLError[]
  console.log(error.partialData) // the data the server sent with the errors, or undefined
}
```

- **A 2xx with neither `data` nor `errors` is a `'parse'` error**, the same rule as an empty body on REST. That covers an empty body, `{}`, `{"data": null}` and a JSON root that isn't an object. `error.body` holds the raw response text, such as `''` or `'{}'`.
- **`{"data": null, "errors": [...]}` is still `kind: 'http'`**, because the errors are checked first. Any partial result is in `error.partialData`.

#### Same as REST, and different

Most of what the guide says about `createApi` holds for `createGraphQL`.

**The same as REST**

- **Every call returns a `Result`**, `{ data, error, response, retry }`, and `error.kind` names the failure.
- **`middleware`** runs on the client, the `Operation` and the call, in the same order. The context has the same shape, so the [built-in middleware](#retries-caching-and-logging) and yours work unchanged.
- **`headers`** go on the client, the `Operation` and the call, and merge by the [three levels](#three-levels-of-settings).
- **`onError`** goes on `createGraphQL` and works as in [Reporting errors with onError](#reporting-errors-with-onerror).
- **`retry()`** is on every `Result`.
- **`dedupe`** goes on the `Operation`, as in [Drop stale calls with dedupe](#drop-stale-calls-with-dedupe).
- **`timeout`** goes on the `Operation` or the call. It is one deadline for the whole call, retries included.
- **`schema`** goes on the `Operation` and validates the response's `data`. The response type stays explicit ([Validating responses](#validating-responses)).
- **`signal` and `skipMiddleware`** go on the call.

**Different from REST**

- **`endpoint`** is the full URL of the GraphQL endpoint. It takes the place of `baseUrl`.
- **Variables always go in the JSON body.** There are no path params, no query strings and no `bodyAs`.
- **Every operation is a `POST`**, with `Content-Type: application/json` unless you set your own.
- **There is no `share`.** An `Operation` can't join identical calls.
- **There is no `responseType`.** The response is always read as JSON.

### Testing your code

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

#### Unmatched routes

A request that matches no route makes the stub throw, so a typo in a path can't pass quietly. liaise catches every `fetch` rejection, so your code sees an ordinary `Result` with `kind: 'network'` and the `Error` in `error.body`. Its message names the method, the URL and every route you defined. Assert on the result, because the call itself never rejects.

```ts
const r = await api.getUser({ id: '42' })   // routes only define 'GET /api/user/:id'
expect(r.error?.kind).toBe('network')
expect(String(r.error?.body)).toMatch(/no route matched GET \/api\/users\/42/)
```

`api` is a client created with `baseUrl: '/api'`.

An empty array for a route behaves the same way, with a descriptive `Error` in `error.body`.

#### Stubbing a Result directly

To stub at the `Result` level instead of the `fetch` level, `successResult(data)` and `errorResult(status, body)` build a well-formed `Result`. This uses Vitest's `vi.spyOn`, and any runner's equivalent works the same way:

```ts
import { successResult, errorResult } from 'liaise/testing'

vi.spyOn(api, 'getUser').mockResolvedValue(successResult({ id: '42', name: 'Ada' }))
vi.spyOn(api, 'getUser').mockResolvedValue(errorResult(404, { message: 'not found' }))
```

More of the stub's behaviour, such as how it handles a signal, is under [liaise/testing behaviours](#liaisetesting-behaviours).

## Recipes

Each recipe below is a complete example that runs against a test, so you can paste it as it is.

### Add an auth header and refresh the token on a 401

With rotating refresh tokens, five requests that all get a 401 at once must not refresh five times: the first refresh invalidates the token the other four send, and the user is logged out.

<!-- tested: auth-refresh -->
```ts
import { createApi, defineRequest, type Middleware } from 'liaise'

type Tokens = { access: string; refresh: string }
type Order = { id: string; total: number }

let tokens: Tokens = { access: 'expired', refresh: 'r1' }

const auth: Middleware = async (ctx, next) => {
  if (ctx.requestName === 'refresh') return next()

  const sentWith = tokens.access
  ctx.request.headers.set('Authorization', `Bearer ${sentWith}`)
  const result = await next()
  if (result.error?.status !== 401) return result

  // Refresh only if nobody has done it since this call was sent. Every call
  // that gets here at the same moment joins one refresh request (share: true).
  if (tokens.access === sentWith) {
    const refreshed = await api.refresh({ token: tokens.refresh })
    if (refreshed.error) return result // refresh failed: keep the 401
    tokens = refreshed.data
  }
  ctx.request.headers.set('Authorization', `Bearer ${tokens.access}`)
  return next() // send the call again with the new token
}

const api = createApi({
  baseUrl: '/api',
  middleware: [auth],
  requests: {
    refresh: defineRequest<Tokens, { token: string }>()({
      method: 'POST',
      path: '/auth/refresh',
      share: true,
    }),
    getOrders: defineRequest<Order[]>()({ method: 'GET', path: '/orders' }),
  },
})
```

`share: true` on `refresh` is what makes the five calls wait for one refresh. The `requestName` check stops the refresh call from passing through its own middleware.

### Search as you type

Each keystroke starts a request, and a slow answer to an early one can arrive after a fast answer to a later one. `dedupe` makes sure only the latest search is shown.

`Repo` is your result type; `render` and `showError` stand for your UI code.

<!-- tested: search-as-you-type -->
```ts
import { createApi, defineRequest } from 'liaise'

const search = defineRequest<Repo[], { q: string }>()({
  method: 'GET',
  path: '/search',
  dedupe: true, // a new call cancels the one still in flight
})
const api = createApi({ baseUrl: '/api', requests: { search } })

async function onInput(q: string) {
  const { data, error } = await api.search({ q })
  if (error?.kind === 'abort') return // a newer search replaced this one
  if (error) return showError(error)
  render(data)
}
```

The older call settles with an `abort` error, which you skip. Only the newest search reaches `render`.

### Use with TanStack Query

liaise never throws. TanStack Query expects a failing query function to throw, so `unwrap` converts at that one boundary. `api` is the client from [Quick start](#quick-start).

<!-- tested: tanstack-query -->
```ts
import type { Result } from 'liaise'

// TanStack Query expects a failed query to throw. Do it here, at your edge.
async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
  const { data, error } = await call
  if (error) throw error
  return data
}

export const userQuery = (id: string) => ({
  queryKey: ['user', id],
  // TanStack's signal cancels the request when the query is no longer needed.
  queryFn: ({ signal }: { signal: AbortSignal }) => unwrap(api.getUser({ id }, { signal })),
})

// React:  useQuery(userQuery(id))
// Vue:    useQuery(computed(() => userQuery(id.value)))
// Svelte: createQuery(() => userQuery(id))
// Solid:  useQuery(() => userQuery(id()))
```

The same options object works with every TanStack adapter; the comments show the call in each. These comment lines aren't executed by the test.

### Use with React

With React's `useEffect` and `useState` (import them from `react`). `api` and `User` are from [Quick start](#quick-start).

<!-- tested: react-effect -->
```ts
function useUser(id: string) {
  const [state, setState] = useState<{ user?: User; failed?: boolean }>({})

  useEffect(() => {
    const controller = new AbortController()
    api.getUser({ id }, { signal: controller.signal }).then(({ data, error }) => {
      if (error?.kind === 'abort') return // unmounted, or id changed
      setState(error ? { failed: true } : { user: data })
    })
    return () => controller.abort() // cancel when the component goes away
  }, [id])

  return state
}
```

Aborting on cleanup means a fast navigation never writes stale data into a component that has moved on.

### Load the current user into a store

The header, sidebar and avatar each check the store on first render, find it empty, and each ask for the user. `User` is your type.

<!-- tested: store-me -->
```ts
import { createApi, defineRequest } from 'liaise'

const me = defineRequest<User>()({ method: 'GET', path: '/me', share: true })
const api = createApi({ baseUrl: '/api', requests: { me } })

// Any store works the same way: Zustand, Pinia, Redux or a plain object.
const store = { user: null as User | null }

async function loadUser() {
  if (store.user) return // empty on first render, for every component
  const { data } = await api.me() // callers at the same moment join one request
  if (data) store.user = data
}
```

TanStack Query dedupes this case too; this recipe is for apps using a plain store.

### One /me per page view on the server

On the server there's no store. A page's loaders run in parallel and each one needs the current user. `User` and `IncomingRequest` stand for your types; `cookie` stands for however you pass the user's identity.

<!-- tested: server-loaders -->
```ts
import { createApi, defineRequest } from 'liaise'

const me = defineRequest<User>()({ method: 'GET', path: '/me', share: true })

// One client per incoming request: that page's loaders share one /me call,
// and one user's call can never join another user's.
function apiFor(req: IncomingRequest) {
  return createApi({
    baseUrl: 'https://users.internal',
    headers: { cookie: req.headers.cookie ?? '' },
    requests: { me },
  })
}

async function renderPage(req: IncomingRequest) {
  const api = apiFor(req)
  const [header, cart] = await Promise.all([
    api.me().then(r => r.data?.name),   // header loader
    api.me().then(r => r.data?.cartId), // cart loader
  ])
  return { header, cart }
}
```

The client is created per request so that one user's call can never join another's; see [On a server](#on-a-server). Inside React Server Components, React's `cache()` does this too.

### Retry a flaky backend within one deadline

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

With `timeout: 3000`, the caller gets an answer within three seconds however many retries are left. See [Cancelling, deadlines and stale requests](#cancelling-deadlines-and-stale-requests).

### Give each attempt its own timeout

liaise's `timeout` is one deadline for the whole call. If you want axios-style limits per attempt instead, put a middleware *inside* the retry. `getUser` is the endpoint from [Quick start](#quick-start).

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

Timeouts aren't retried by default; the `retryOn` above opts in. Because the middleware replaces `ctx.request.signal`, a caller's own cancel still ends the call as `'abort'`, but the request itself keeps running until the per-attempt signal fires (see [Signals in middleware](#signals-in-middleware)).

### Report errors to Sentry

Send every unexpected failure to your error tracker from one place. `Sentry` stands for your error tracker; `getUser` is the [Quick start](#quick-start) endpoint.

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

Use a middleware instead when you need timing, or the request before it's sent, or want to report for some endpoints only. [Writing middleware](#writing-middleware) has the middleware version.

### Upload and download files

Send a file with `FormData` and read one back as a `Blob`.

<!-- tested: files -->
```ts
import { createApi, defineRequest } from 'liaise'

// Upload: pass FormData as the params. liaise sends it as-is, and the
// runtime sets the multipart Content-Type with its boundary.
const uploadAvatar = defineRequest<{ url: string }, FormData>()({
  method: 'POST',
  path: '/avatar',
})

// Download: ask for a Blob instead of JSON.
const downloadFile = defineRequest<Blob>()({
  method: 'GET',
  path: '/files/:id',
  responseType: 'blob',
})

const api = createApi({ baseUrl: '/api', requests: { uploadAvatar, downloadFile } })
```

Call it with `api.uploadAvatar(form)` and `api.downloadFile({ id })`. Other body types (a `Blob`, a `ReadableStream`) are listed under [Sending data](#sending-data).

## Philosophy

### Never throws

Every API call returns a `Result<T>`. HTTP errors, network failures, parse errors, and even synchronous exceptions during request setup are all captured and returned as structured `{ data, error, response, retry }` objects. No try/catch required at call sites.

### Zero dependencies

The library uses only the standard `fetch` API and built-in web platform types (`Headers`, `AbortController`, `FormData`, `URLSearchParams`, `Blob`, `ArrayBuffer`). There is nothing to install, audit, or bundle beyond the library itself.

### Middleware over interceptors

Instead of separate `onRequest`/`onResponse` interceptor hooks, the library uses a composable onion model where each middleware wraps the next. This means a single function can modify the request, inspect the response, retry on failure, or short-circuit entirely. Three layers (global, per-request, per-call) plus `skipMiddleware` give fine-grained control without configuration complexity.

### Typed dot-access

Type safety comes from inference, not annotation. Define `Request<TParams, TResponse>` once, and `createApi` infers everything downstream. The call site (`api.getUser(...)`) is fully typed with zero extra work.

### Runtime-agnostic

No assumptions about Node.js, browsers, or any specific runtime. If your environment has `fetch`, the library works -- browsers, Node.js 20+, Bun, Deno, React Native (its built-in `fetch`; not tested in CI), Cloudflare Workers, edge runtimes. Where `AbortSignal.timeout` is missing (React Native's Hermes), `timeout` falls back to `AbortController` plus `setTimeout`; the failure is `kind: 'timeout'` where the runtime's `AbortController` carries abort reasons, and possibly `'abort'` where it does not. Not tested on a device.

### Framework-agnostic

The library has no opinion about your UI framework, or whether you have one. A client is a plain object of functions that return promises, so the same definitions work in React, Vue, Svelte, Solid or Angular, in server loaders and actions, in workers, scripts and CLIs — and keep working when you change frameworks. It also means there are no hooks out of the box: pair it with the state or query library you already use (TanStack Query, SWR, Pinia, a store of your own). Those libraries expect a failed request to throw, so the query function is the place to turn a `Result`'s `error` into a throw — at the edge of your code, not inside this library.

## API Reference

### Core (`liaise`)

| Export          | Kind     | Description                                                        |
| --------------- | -------- | ------------------------------------------------------------------ |
| `createApi`     | function | Creates a typed API client from a config of Request definitions    |
| `Request`       | class    | Typed endpoint definition -- one instance per endpoint             |
| `defineRequest` | function | Typed factory — infers path params from the `path` literal, and enforces `responseType: 'none'`. |
| `paginate` | function | Walks a paginated endpoint, yielding one `Result` per page. |
| `PaginateOptions` | type | `next`, `maxPages`, and any `CallOptions`. |
| `StandardSchemaV1` | type | The Standard Schema contract — for typing a helper that takes a validator. |
| `InferOutput`      | type | The type a schema produces on success. |
| `StandardIssue`    | type | One validation failure -- the shape of each entry in `error.body` when a schema refuses. |
| `ApiError`      | class    | Structured error with status, kind, body, headers, and request metadata |
| `ApiErrorKind`  | type     | `'http' \| 'network' \| 'abort' \| 'timeout' \| 'parse' \| 'middleware'` -- discriminates `ApiError.kind` |
| `RequestConfig` | type     | Config object for the `Request` constructor                        |
| `ApiConfig`     | type     | Config object for `createApi`                                      |
| `CallOptions`   | type     | Per-call overrides (`middleware`, `skipMiddleware`, `headers`, `signal`, `timeout`) |
| `Result`        | type     | Discriminated union of every API call's outcome: `SuccessResult<T> \| ErrorResult<T>` |
| `SuccessResult` | type     | The success branch of `Result`: `{ data: T, error: null, response: Response, retry }` |
| `ErrorResult`   | type     | The error branch of `Result`: `{ data: null, error: ApiError, response: Response \| null, retry }` |
| `Middleware`    | type     | Middleware function signature: `(ctx, next) => Promise<Result>`    |
| `MiddlewareContext` | type | Request context passed to middleware                               |
| `MiddlewareNext` | type    | The `next` function passed to middleware                           |
| `createGraphQL`     | function | Creates a typed GraphQL client from a config of Operation definitions  |
| `Operation`         | class    | Typed operation definition -- one instance per GraphQL operation       |
| `gql`               | const    | Tagged template literal for GraphQL documents (editor tooling support) |
| `OperationConfig`   | type     | Config object for the `Operation` constructor                          |
| `GraphQLBaseConfig` | type     | Config object for `createGraphQL`                                      |
| `GraphQLError`      | type     | Shape of a single GraphQL error from `{ errors: [...] }`              |

### Built-in middleware (`liaise/middleware`)

| Export            | Kind     | Description                                                   |
| ----------------- | -------- | ------------------------------------------------------------- |
| `retryMiddleware` | function | Factory that returns middleware retrying on 5xx by default, with a configurable backoff policy |
| `RetryOptions`    | type     | Options object accepted by `retryMiddleware` (`max`, `delay`, `baseDelay`, `maxDelay`, `jitter`, `respectRetryAfter`, `retryOn`, `onRetry`) |
| `RetryInfo`       | type     | Shape of the argument passed to `RetryOptions.onRetry`         |
| `logMiddleware`   | const    | Middleware that logs request lifecycle to the console          |
| `cacheMiddleware` | function | Factory that returns a per-request in-memory cache with `clear()` |
| `CacheMiddleware` | type     | Return type of `cacheMiddleware()` -- a `Middleware` with an attached `clear()` |

### Testing (`liaise/testing`)

| Export          | Kind     | Description                                                        |
| --------------- | -------- | ------------------------------------------------------------------ |
| `mockFetch`     | function | Builds a route-matching `fetch` stub, with `install()`/`restore()`, call recording, and response sequencing |
| `jsonResponse`  | function | Builds a `Response` with a JSON body and a `content-type` header, for use as a route value |
| `successResult` | function | Builds a well-formed success `Result<T>` directly, for stubbing at the `Result` level |
| `errorResult`   | function | Builds a well-formed error `Result<T>` with a given HTTP status, for stubbing at the `Result` level |
| `RouteContext`  | type     | `{ params, request }` passed to a route handler function          |
| `RouteHandler`  | type     | `(ctx: RouteContext) => Response \| Promise<Response>` -- a route value that computes its response |
| `RouteValue`    | type     | `Response \| RouteHandler \| Array<Response \| RouteHandler>` -- anything a route key can map to |
| `RecordedCall`  | type     | `{ method, url, headers, body }` -- shape of each entry in `mock.calls` |

## Contributing

Bug reports, fixes and ideas are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to report a bug, run the tests, and the few rules a pull request is checked against.

## License

MIT

## Reference (in progress)

These facts are waiting for the final Reference section.

### Result type

```ts
interface SuccessResult<TResponse> {
  data: TResponse                          // parsed response
  error: null
  response: Response                       // always present on success
  retry: () => Promise<Result<TResponse>>
}

interface ErrorResult<TResponse> {
  data: null
  error: ApiError                          // structured error, see below
  response: Response | null                // present for HTTP/parse failures, null for network/abort/timeout
  retry: () => Promise<Result<TResponse>>
}

type Result<TResponse> = SuccessResult<TResponse> | ErrorResult<TResponse>
```

### ApiError

The error object on failed calls. It is not a subclass of `Error` -- it is a structured container for API-level error details.

| Property     | Type      | Description                                                       |
| ------------ | --------- | ----------------------------------------------------------------- |
| `status`     | `number`  | HTTP status code (e.g., 404, 500). `0` for network errors, aborts, and timeouts. |
| `kind`       | `'http' \| 'network' \| 'abort' \| 'timeout' \| 'parse' \| 'middleware'` | What category of failure this is. See below. Required -- constructing an `ApiError` yourself (e.g. in custom middleware) must supply it. |
| `statusText` | `string`  | HTTP status text (e.g., 'Not Found'). `''` for network errors.    |
| `body`       | `unknown` | Parsed response body -- but for `'parse'`, one of: the thrown exception (a malformed body), the raw response text (an empty body, or a GraphQL response carrying no data), a schema's issues array (the response failed validation), or a value a schema threw. The native Error for network failures. |
| `headers`    | `Headers` | Response headers. Empty `Headers` for network errors.             |
| `request`    | `object`  | `{ method, url, params }` -- metadata about the failed request; `url` is the resolved, path-substituted address, falling back to the route template only when it could not be built. |
| `partialData` | `unknown` (optional) | GraphQL data returned alongside `{ errors }` (partial success). Lives here, not on `Result.data`, so the `Result` stays a clean union: `data` is non-null iff `error` is null. `undefined` for every REST error and for GraphQL responses carrying no data. |

You can use `instanceof` to check if a value is an `ApiError`:

```ts
import { ApiError } from 'liaise'

if (error instanceof ApiError) {
  // ...
}
```

### baseUrl query merging

A `baseUrl` may carry its own query string — a fixed API key, say. Its params
are merged ahead of the call's:

```ts
const api = createApi({
  baseUrl: 'https://api.example.com/v1?key=abc',
  requests: { search: new Request<{ q: string }, Hit[]>({ method: 'GET', path: '/search' }) },
})

await api.search({ q: 'hello' })
// GET https://api.example.com/v1/search?key=abc&q=hello
```

Merging **accumulates**, it does not override: a call param whose key the base
already used produces both, `?key=abc&key=xyz`, and which one wins is the
server's decision. This differs from headers, where a per-call value replaces a
global one — because array params already serialize as repeated keys
(`tags=a&tags=b`), so collapsing duplicates would break them. If a base-level
param needs to vary per call, set it from middleware rather than the `baseUrl`.

### URL fragments

**A `#fragment` is refused.** A fragment is never sent to the server, so one in
a `path` or `baseUrl` cannot do what it appears to. It is an error naming the offending
value, rather than being stripped, so the dead code does not stay in your
template.

A fragment in a [`defineRequest`](#defining-endpoints) `path` **literal**
is also a compile error, so the endpoint is rejected where it is declared rather
than on every call:

```ts
defineRequest<Doc>()({ method: 'GET', path: '/docs#section' })
//                                          ^ Property '__fragmentInPath' is missing:
//                                            a URL fragment is never sent to the server
```

The check reads the literal, so a path assembled at runtime — or a
`RequestConfig`-typed variable — still compiles and is caught by the runtime
error instead. `new Request` takes no path literal, so it has no equivalent
check; this is one of the things `defineRequest` buys you.

**A `#` inside a param *value* is not a fragment** and is never refused — it is
escaped to `%23` and sent as ordinary data:

```ts
await api.getDoc({ id: 'a#b' })   // → GET /docs/a%23b
await api.search({ tag: 'a#b' })  // → GET /search?tag=a%23b
```

Only a `#` written into a `path` or `baseUrl` is refused, because that one was
never going to reach the server.

### Timeout backstop

**The deadline bounds middleware that never looks at the signal, too.** A middleware that awaits something of its own before calling `next()` — a token refresh, say — cannot hold the call past its `timeout`, even if that work never settles:

```ts
const auth: Middleware = async (ctx, next) => {
  const token = await user.getIdToken()   // stalls on a bad network
  ctx.request.headers.set('Authorization', `Bearer ${token}`)
  return next()
}
// With timeout: 45_000, the call still settles at ~45s: kind 'timeout', status 0.
```

When the deadline passes, the chain gets one macrotask to answer by itself. That is enough for everything that already responds to the abort — `fetch` rejecting, a middleware rethrowing the reason, a fallback middleware that turns a timeout into a cached response — so all of those keep their own `Result` exactly as before. A chain still pending after that is waiting on something the signal does not reach, and the call settles with the same `Result` an aborted `fetch` would have produced: `kind: 'timeout'`, `status: 0`, reported to `onError` once. A caller's own `signal` works the same way, with `kind: 'abort'`, which is not reported.

A promise cannot be cancelled, so the stalled middleware keeps running. Whatever it eventually returns or throws is discarded — no second `Result`, no second `onError` — and if it calls `next()` after the call has settled, no request is sent: `next()` hands back the `Result` the caller already has. To stop the work itself, pass `ctx.request.signal` into it (see [`MiddlewareContext`](#middlewarecontext)).

### Abort classification

A cancellation is classified by **provenance**, not by sniffing the thrown value's shape: whatever a middleware or `fetch` actually throws, if it happened because *this request's own signal* aborted, the `Result` is `kind: 'abort'` (or `'timeout'` for a deadline) regardless of the reason's name or type -- a caller-supplied custom abort reason (`controller.abort(new Error('unmounted'))`, or a plain string) still classifies as `'abort'`, not `'network'`.

A middleware that propagates the library's own abort/timeout signal (verbatim, or wrapped one level as `.cause`) is classified `'abort'`/`'timeout'` instead of `'middleware'`, by provenance rather than by the reason's name.

### Stream bodies

Under `retryMiddleware`, the "cannot resend" error is the Result you end up with: after a 5xx, the final Result is the "cannot resend" `TypeError` (status 0), so the original 503 is not in it.

### Share key and refcount

**What counts as "identical":** the request name plus a content-based key of the params — object keys sorted, `undefined` members dropped (so `{ a: undefined }` and `{}` are one key), anything with `toJSON` keyed by what it returns (a `Date` is its ISO string), `Map`, `Set` and typed arrays keyed by their entries. Two calls with the same params to the same endpoint share; different params (or different endpoints) never do.

**What does *not* disable sharing:** a per-call `signal` or `timeout`. These bound *who is still waiting*, not *what is being asked for*, so they're tracked with a per-caller refcount instead: each sharer's own signal/timeout only removes that caller from the wait list. The underlying request keeps running for everyone else, and is only aborted once every sharer — including the one that gave up — has stopped waiting. A sharer that gives up gets an error `Result` (`kind: 'timeout'` or `kind: 'abort'`), reported to `onError` exactly as the identical non-shared call would be — which means a `'timeout'` give-up reports and an `'abort'` give-up does not (see [Reporting errors with onError](#reporting-errors-with-onerror)).

**A per-*request* `timeout` is different: it belongs to the operation.** `RequestConfig.timeout` bounds the single shared request itself, measured from when that request started — not from when each caller joined it. Every sharer is therefore bounded by it, a late joiner cannot extend it, and a caller passing `timeout: 0` cannot switch it off for everyone else. Without that, a steadily arriving stream of joiners would keep one socket open indefinitely against a deadline that was supposed to cap it.

### `retry()` on a shared result

**`result.retry()` on a shared result** re-runs the pipeline using the *acquiring caller's* own per-call options (headers, signal, timeout) — that is, whichever call first started the shared request, not whichever caller happens to invoke `retry()`. This falls out of every non-aborting sharer receiving the literal same `Result` object; it's unavoidable given that design, but worth knowing before relying on it.

### Signal-replacing middleware

**Signal-replacing middleware is safe under `share: true`.** A middleware that installs its own `ctx.request.signal` (a per-attempt timeout, say) does not detach the shared request from the refcount: the refcount signal is merged back in before `fetch`, so the request is still aborted once every sharer has given up.

Under `dedupe: true` your signal is merged rather than discarded: the request is cancelled by whichever fires first -- your signal, or a newer call superseding this one. The dedupe signal is installed by the core fetch, so middleware reading `ctx.request.signal` before `next()` sees the caller's signal, not the dedupe one.

### RetryOptions

Automatically retries requests that fail, with a real backoff policy — exponential (or linear, or custom) delay curves, full jitter, `Retry-After` support, a configurable retry predicate, and an observational `onRetry` hook.

| Option              | Type                                              | Default          | Description |
| -------------------- | -------------------------------------------------- | ----------------- | ----------- |
| `max`                | `number`                                            | `3`               | Additional attempts after the first. `retryMiddleware({ max: 2 })` means up to 3 total calls. |
| `delay`              | `'exponential' \| 'linear' \| (attempt: number) => number` | `'exponential'`   | The delay curve. Exponential is `baseDelay * 2^(attempt-1)`; linear is `baseDelay * attempt`; a function receives the 1-based attempt number and returns milliseconds. |
| `baseDelay`          | `number`                                            | `250`             | The first delay, in milliseconds, before jitter and `Retry-After` are applied. |
| `maxDelay`           | `number`                                            | `30000`           | Hard cap applied to every computed delay, including a `Retry-After` value. |
| `jitter`             | `boolean`                                           | `true`            | Full jitter: the actual delay is `Math.random() * computed`, per AWS's recommendation for de-synchronizing a thundering herd. Never applied to a `Retry-After` value — a server telling you exactly when to come back should not be randomized. |
| `respectRetryAfter`  | `boolean`                                           | `true`            | Honor a `Retry-After` response header (delta-seconds or an HTTP-date) when present, replacing the computed delay outright (still capped by `maxDelay`). |
| `retryOn`            | `(result: Result<unknown>, attempt: number) => boolean` | `r => (r.error?.status ?? 0) >= 500` | Whether to retry. Called with the 1-based *candidate* attempt number, even once `max` is reached, so a predicate that counts attempts sees one call per result. |
| `onRetry`            | `(info: RetryInfo) => void`                         | —                 | Observational hook fired before each retry's delay elapses. Its return value is ignored, and a throw cannot fail the request — this is the only way to observe an in-progress retry sequence, since the call site sees nothing until the final result. |

`RetryInfo` (the argument to `onRetry`): `{ attempt, max, delay, result }` — `attempt` is 1-based (the first retry is `1`), `delay` is the actual delay about to elapse (after jitter and `Retry-After`), and `result` is the `Result` that triggered this retry.

**429 and network errors are opt-in.** The default `retryOn` leaves them out. [Retries, caching and logging](#retries-caching-and-logging) shows how to add them.

**An abort during backoff surfaces as the abort, not the stale result it was retrying.** If the signal driving the request — a whole-operation `timeout`, a caller's own `AbortSignal`, or a dedupe supersede — fires while `retryMiddleware` is sleeping between attempts, the backoff sleep resolves immediately and the loop proceeds straight to the next attempt, which the core fetch rejects instantly (no network call) because the signal is already aborted. The caller receives **that abort** — `kind: 'timeout'` for a deadline, `kind: 'abort'` for a cancellation or a dedupe supersede — never the last real HTTP result (e.g. a stale `503`) that triggered the retry in the first place:

```ts
const api = createApi({
  baseUrl: '/api',
  requests: {
    getItems: new Request<Record<string, never>, Item[]>({
      method: 'GET',
      path: '/items',
      timeout: 2000, // whole-operation deadline
    })
  },
  middleware: [retryMiddleware({ max: 5, baseDelay: 1000 })], // long backoff
})

const { error } = await api.getItems()
// If the 2s deadline fires while retryMiddleware is asleep between attempts:
// error.status === 0, error.kind === 'timeout' -- not the 503 being retried
```

### Cache key

Caches successful responses in memory, keyed by request name, method, the full URL, params and every request header except `Content-Type` (which is derived from the params). The URL's query string is part of the key with its pairs sorted by name, so `?a=1&b=2` and `?b=2&a=1` are one entry, while `?key=A` and `?key=B` (or a `?lang=de` appended by a middleware before the cache) are not. Calls that agree on all of those within the TTL window are served from cache without hitting the network. A different `Authorization` or any other header (except `Content-Type`), a different base URL, path or query value gets its own entry, so one user is never served another's response; the same query params in a different order share one. The query is sorted by raw (undecoded) name, keeping the order of repeated names. The trade-off: a middleware that adds a per-call unique header (a request ID, say) must come *after* `cacheMiddleware` in the middleware array; placed before it, every call carries a fresh header and nothing is ever cached. Each `cacheMiddleware()` call creates an isolated store — different endpoints never share entries.

Params are keyed by content, at every depth: plain data as sorted JSON with `undefined` members dropped (so `{ a: undefined }` and `{}` are one key), anything with `toJSON` by what it returns (a `Date` is its ISO string), and `Map`, `Set` and typed arrays by their entries. A call whose params cannot be keyed soundly — a BigInt, an `ArrayBuffer`, `Blob`, `FormData` or `URLSearchParams`, or an object with no enumerable state such as a class instance holding private fields — is never cached and never served from cache. The rule is the same one `share` uses; see [Sharing](#sharing-identical-requests).

### MiddlewareContext

The context object passed to each middleware:

| Property              | Type      | Description                                              |
| --------------------- | --------- | -------------------------------------------------------- |
| `request.method`      | `string`  | HTTP method (GET, POST, etc.)                            |
| `request.url`         | `string`  | Fully resolved URL with path params and query string     |
| `request.path`        | `string`  | Original path template (e.g., '/users/:id')              |
| `request.params`      | `unknown` | Original params object from the caller                   |
| `request.headers`     | `Headers` | Merged headers -- middleware can add/remove entries       |
| `request.body`        | `unknown` | Serialized body, or null for GET/DELETE                  |
| `request.signal`      | `AbortSignal \| undefined` | The signal handed to `fetch` -- replace it to impose your own cancellation policy |
| `requestName`         | `string`  | Key name in the requests object (e.g., 'getUser')        |

`request.signal` holds the call's own signal: the caller's `options.signal` merged with any `timeout` (and, under `share: true`, with the refcount that aborts the shared request once every sharer has given up). It is `undefined` only when there is none of those. The core fetch reads the field at call time, so replacing it takes effect. A middleware can replace it; see [Signals in middleware](#signals-in-middleware).

### liaise/testing behaviours

- **`mock.fetch` honours `init.signal`, like real `fetch`.** An already-aborted signal rejects with its `reason`, and so does one that aborts while a route handler is still pending — so a stalled route (`() => new Promise(() => {})`) lets you test your own `timeout` and cancellation handling through the stub. An aborted call is still recorded in `calls` and counted by `callCount`, but does not use up a response from a sequence.
- **`restore()` assumes `globalThis.fetch` was defined when `install()` ran** — true on Node 20+ (and in every browser), since `fetch` is a global there. If you somehow call `install()` in an environment where `globalThis.fetch` is `undefined` beforehand, `restore()` puts back that `undefined` rather than inventing a real `fetch`.
- **A route key must be `"METHOD /path"`.** A key with no space (`'/users'`) throws at `mockFetch(...)` time, naming the offending key, rather than silently registering a route that can never match.
- **Declaration order decides when two same-length routes could both match.** Routes are matched in the order they appear in the object you pass to `mockFetch`, and the first structural match wins — put more specific routes first if two patterns could both match the same path.
- **Trailing and duplicate slashes are normalized away on both sides.** `/a/b/`, `/a//b`, and `/a/b` all match the same route, whether the extra slash is in the route key or in the URL the library actually built.
