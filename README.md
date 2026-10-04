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
- [Choosing liaise](#choosing-liaise)
  - [When it fits, and when it doesn't](#when-it-fits-and-when-it-doesnt)
  - [How it compares](#how-it-compares)
  - [Where it runs](#where-it-runs)
- [Design principles](#design-principles)
- [Reference](#reference)
  - [createApi options](#createapi-options)
  - [createGraphQL options](#creategraphql-options)
  - [Endpoint options](#endpoint-options)
  - [Operation options](#operation-options)
  - [CallOptions](#calloptions)
  - [getHeaders()](#getheaders)
  - [Result and ApiError](#result-and-apierror)
  - [MiddlewareContext](#middlewarecontext)
  - [Built-in middleware options](#built-in-middleware-options)
  - [liaise/testing](#liaisetesting)
  - [Exports](#exports)
  - [Behaviour in detail](#behaviour-in-detail)
- [Upgrading, contributing, licence](#upgrading-contributing-licence)

## The problem it solves

`fetch` is a good building block. Every project still ends up writing the same few things around it, and they are easy to get subtly wrong.

| With plain fetch | liaise | See |
| ---------------- | ------ | --- |
| Typing fast in a search box shows old results. A slow early search lands last. | `dedupe` cancels the older call. | [Stale requests](#drop-stale-calls-with-dedupe) |
| Five components load the same data, or five 401s each refresh the token. That's five identical requests. | `share` sends one and hands everyone the answer. | [Sharing identical requests](#sharing-identical-requests) |
| A 500 counts as success, offline throws, a hung server waits forever. | Every call returns `{ data, error }`, and `error.kind` names the failure. With `timeout` set, a hung server becomes an error too. | [Handling errors](#handling-errors) |
| Retries run straight past your timeout. | `timeout` covers the whole operation, retries included. | [Deadlines](#set-a-deadline-with-timeout) |
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

Types flow from the endpoint definition through `createApi` to every call, so you never annotate a call. When you need a type by name, it is listed under [Exports](#exports).

### The path of one call

```text
params → URL + body → your middleware → fetch → parse → validate → Result
```

Any step can fail, and the failure lands in `error` instead of being thrown.

### Three levels of settings

You can write a setting in three places: on the client, on the endpoint, or on one call. For headers and `timeout`, the most specific one wins. For middleware, every level runs, the client's first.

| Level | Where you write it | `headers` | `middleware` | `timeout` |
| ----- | ------------------ | --------- | ------------ | --------- |
| Client | `createApi({ headers, middleware, timeout })` | Sent with every call | Runs first, around everything else | Applies to every call |
| Endpoint | `defineRequest<T>()({ headers, middleware, timeout })` | Replaces the client's value for the same header | Runs second | Replaces the client's |
| Call | `api.getUser(params, { headers, middleware, timeout })` | Replaces the client's and the endpoint's value for the same header | Runs last, closest to `fetch` | Replaces the endpoint's and the client's |

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

api.getReport.getHeaders() // { 'x-api-version': '2' }
```

[`getHeaders()`](#getheaders) shows the headers an endpoint sends from the client and the endpoint, before any call adds its own.

`timeout: 0` at the most specific level means no deadline ([details](#set-a-deadline-with-timeout)).

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
- **A non-2xx response is always `'http'`**, even when its body doesn't parse. liaise checks the status before it reads the body, so a 500 with broken JSON is still a 500, and [`retryMiddleware`](#retry-failed-calls) still retries it.
- **`response` is for the status and headers.** liaise has already read its body to produce `data` or `error.body`, so `response.json()` throws "Body has already been read". A `Response` you build yourself for `successResult()` in tests keeps its body.
- Every field of `error` is listed under [`ApiError`](#result-and-apierror).

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

- It runs once per call, after all your middleware has finished. A call that a retry middleware rescues from a 500 never reaches it. When calls [share](#sharing-identical-requests) one failed request, it runs once for all of them.
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
- **Declare `'none'` with the response type `undefined`.** `defineRequest` enforces this ([Defining endpoints](#defining-endpoints)). [Without defineRequest](#without-definerequest) it is only a convention, and `data` is `undefined` at runtime whatever type you wrote.
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
- **The GraphQL `Operation` ([GraphQL](#graphql)) takes `schema` too**, and validates the response's `data`. There the response type stays explicit, because only `defineRequest` infers it:

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
- If you want a separate limit for each attempt instead, see [Give each attempt its own timeout](#give-each-attempt-its-own-timeout).
- Under [`share`](#sharing-identical-requests), the endpoint's or the client's `timeout` also bounds the one shared request ([details](#share-key-and-refcount)).

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

Several parts of an app often ask for the same thing at the same moment. Five components load the current user, or five calls get a 401 and each one refreshes the token.

`share: true` merges calls that would send the identical request, with the same URL, method, headers and body, into one network request. Each call still runs its own middleware and gets its own `Result`.

```ts
import { createApi, defineRequest } from 'liaise'

type Product = { id: string; name: string }

const getProduct = defineRequest<Product>()({
  method: 'GET',
  path: '/products/:id',
  share: true,
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { getProduct } })

// One network request. Each caller gets its own Result from it.
const [a, b] = await Promise.all([
  api.getProduct({ id: '42' }),
  api.getProduct({ id: '42' }),
])
```

If two requests are the same byte for byte, the server can't tell them apart either, so sharing them is safe. Apart from tracing headers, if anything differs, they never share.

- **The request is compared after all your middleware has run.** A header your auth middleware adds is part of it, so calls made as different users don't share. [On a server](#on-a-server) says what this relies on.
- **The URL and the body are compared as sent.** `?a=1&b=2` and `?b=2&a=1` don't share, and neither do two JSON bodies with the same keys in a different order. Params written in the same order always match.
- **Per-call `headers` and `middleware` are judged by what they change.** Calls with identical per-call headers share, and a per-call middleware that changes nothing doesn't stop sharing.
- **Tracing headers aren't compared**, so a middleware that stamps a request ID on every call doesn't stop sharing. The shared request goes out with the first caller's tracing headers. [Share key and refcount](#share-key-and-refcount) lists them.
- **An upload never shares.** A call whose body is `FormData`, a `Blob`, an `ArrayBuffer`, a typed array, a `DataView` or a `ReadableStream` sends its own request.
- **Each caller has its own `data` for JSON and text.** A middleware that edits `data` changes only its own caller's copy ([details](#share-key-and-refcount)).
- **[`onError`](#reporting-errors-with-onerror) hears about a failed shared request once**, however many callers get the error. An error that a caller's own middleware makes from it is reported separately.
- **A call that arrives after the shared request has settled sends a new one.** Nothing is cached. For that, use [`cacheMiddleware`](#cache-repeated-reads).
- **Think before you set `share` on a write.** Two identical writes at the same moment become one, so adding the same item to a cart twice at once adds it once. That suits a refresh-style call, such as the [token refresh](#add-an-auth-header-and-refresh-the-token-on-a-401), and rarely other writes.
- **`share` joins the call already running. [`dedupe`](#drop-stale-calls-with-dedupe) cancels it.** Setting both on one endpoint throws when you create the client, so you find the mistake straight away.
- **A per-call `signal` or `timeout` only lets that caller leave.** The caller that gives up gets `kind: 'abort'` or `'timeout'`. The request keeps running for the others, and is cancelled once every caller has given up.

```ts
const impatient = api.getProduct({ id: '42' }, { timeout: 20 }) // gives up quickly
const patient = api.getProduct({ id: '42' })                    // keeps waiting

// impatient's timeout doesn't cancel the shared request, so patient still gets the response.
```

How the shared request's own deadline, its timeouts and retries work is under [Share key and refcount](#share-key-and-refcount). A middleware that replaces the signal has its own note, under [Signal-replacing middleware](#signal-replacing-middleware).

#### On a server

One client can serve every user. The user's token or cookie is part of what is sent, so one user's call never joins another's. [One /me per page view on the server](#one-me-per-page-view-on-the-server) shows the setup.

The comparison sees only the headers in `ctx.request.headers`. If something outside liaise adds the user's identity, such as a patched global `fetch` or instrumentation that reads request context, liaise can't see it, and `share` is unsafe in that setup.

### Retries, caching and logging

Some failures go away when you try again. Some reads repeat often enough to keep. And while you build, you want to see every call. Retries and caching are middleware, imported from a separate entry point:

```ts
import { retryMiddleware, cacheMiddleware } from 'liaise/middleware'
```

Logging is the client's `log` option ([Log every call](#log-every-call)).

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
- The options are `ttl`, `maxSize` and `debug` ([Cache options](#cache-options)).

#### Log every call

`log: true` on the client prints each call's start and end to the console, with its duration. Logging is off by default.

```ts
import { createApi, defineRequest } from 'liaise'

const getItems = defineRequest<{ id: string }[]>()({ method: 'GET', path: '/items' })

const api = createApi({
  baseUrl: '/api',
  requests: { getItems },
  log: import.meta.env.DEV, // on in development only (Vite); in Node: process.env.NODE_ENV !== 'production'
})
```

```text
[liaise] → GET getItems /api/items
[liaise] ← getItems OK (142ms)

[liaise] → POST createUser /api/users
[liaise] ← createUser ERROR 422 (89ms)
```

- **Each call logs once, with its final outcome.** The logger runs outside all your middleware, so a call that `retryMiddleware` retries still logs one pair of lines.
- **`log: { data: true }` also prints each call's data, or its `error.body` on failure** ([Log options](#log-options)). `data` is off by default, because responses often hold personal data and tokens, and a long list makes the console slow.
- **A call that joined a [shared](#sharing-identical-requests) request ends with `, shared`**, as in `[liaise] ← getUser OK (138ms, shared)`. Its answer came from a request another call sent.
- **To log one endpoint or one call, use `logMiddleware`** in that level's `middleware`. It takes the same options ([Log options](#log-options)):

  ```ts
  import { defineRequest } from 'liaise'
  import { logMiddleware } from 'liaise/middleware'

  const getItems = defineRequest<{ id: string }[]>()({
    method: 'GET',
    path: '/items',
    middleware: [logMiddleware({ data: true })], // or just [logMiddleware]
  })
  ```

Logging is meant for development. In production, [write a middleware](#writing-middleware) that sends the same facts to your monitoring.

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

`ctx.requestName` is the endpoint's key, such as `'getUser'`. `ctx.request` holds the request as it will be sent, with the URL filled in and the body serialized. Every field is listed under [MiddlewareContext](#middlewarecontext).

#### Signals in middleware

`ctx.request.signal` combines the caller's `signal` with the call's deadline, and is `undefined` when there is neither. liaise reads it when it calls `fetch`, so a middleware can replace it. [Give each attempt its own timeout](#give-each-attempt-its-own-timeout) does this, and says what happens to a caller's cancel. How a replaced signal works with `share` and `dedupe` is under [Signal-replacing middleware](#signal-replacing-middleware).

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
- **Every other option applies to every page.** Any of the [`CallOptions`](#calloptions), such as `signal`, `timeout` or `headers`, goes with each request, so one signal cancels the whole walk.
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
- **`share`** goes on the `Operation`, as in [Sharing identical requests](#sharing-identical-requests). Variables must match exactly, key order included. On a mutation, the note there about writes applies.
- **`timeout`** goes on `createGraphQL`, the `Operation` or the call, and the most specific one wins. It is one deadline for the whole call, retries included ([Set a deadline with timeout](#set-a-deadline-with-timeout)).
- **`log`** goes on `createGraphQL`, as in [Log every call](#log-every-call). Each line names the operation, as in `[liaise] → POST getCategory https://api.example.com/graphql`.
- **`getHeaders()`** is on every operation ([getHeaders()](#getheaders)).
- **`schema`** goes on the `Operation` and validates the response's `data`. The response type stays explicit ([Validating responses](#validating-responses)).
- **`signal` and `skipMiddleware`** go on the call.

**Different from REST**

- **`endpoint`** is the full URL of the GraphQL endpoint. It takes the place of `baseUrl`.
- **Variables always go in the JSON body.** There are no path params, no query strings and no `bodyAs`.
- **Every operation is a `POST`**, with `Content-Type: application/json` unless you set your own.
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

More of the stub's behaviour, such as how it handles a signal, is under [liaise/testing](#liaisetesting).

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

`error` is the `ApiError` liaise returned, which isn't an `Error` subclass, so it has no `message`. Read `error.kind` and `error.status`. To type it, register `ApiError` as TanStack's `defaultError`.

### Use with React

This hook uses React's `useEffect` and `useState`, imported from `react`. `api` and `User` are from [Quick start](#quick-start).

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

[TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview) dedupes this case too; this recipe is for apps using a plain store.

### One /me per page view on the server

On the server there's no store. A page's loaders run in parallel and each one needs the current user. `User` and `IncomingRequest` stand for your types; `cookie` stands for however you pass the user's identity.

<!-- tested: server-loaders -->
```ts
import { createApi, defineRequest } from 'liaise'

const me = defineRequest<User>()({ method: 'GET', path: '/me', share: true })

// One client for the whole server. Sharing compares what is actually sent,
// so one user's call never joins another's.
const api = createApi({ baseUrl: 'https://users.internal', requests: { me } })

async function renderPage(req: IncomingRequest) {
  const asUser = { headers: { cookie: req.headers.cookie ?? '' } }
  const [header, cart] = await Promise.all([
    api.me({}, asUser).then(r => r.data?.name),   // header loader
    api.me({}, asUser).then(r => r.data?.cartId), // cart loader
  ])
  return { header, cart }
}
```

Each loader sends the user's cookie as a per-call header. Calls with the same cookie share one request, and calls with different cookies never do ([On a server](#on-a-server)). Inside React Server Components, React's [`cache()`](https://react.dev/reference/react/cache) gives one /me per page view too.

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

With `timeout: 3000`, the caller gets an answer within three seconds however many retries are left. See [Set a deadline with timeout](#set-a-deadline-with-timeout).

### Give each attempt its own timeout

liaise's `timeout` is one deadline for the whole call. If you want a limit per attempt instead, put a middleware *inside* the retry. `getUser` is the endpoint from [Quick start](#quick-start).

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

`ApiError` isn't an `Error`, so it carries no stack trace or `message` of its own. Pass the fields you want to see in `extra`, as above.

Use a middleware instead when you need timing, or the request before it's sent, or want to report for some endpoints only. [Example: report server errors](#example-report-server-errors) has the middleware version.

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

## Choosing liaise

This section helps you decide whether liaise fits your project. It covers when to pick something else, how liaise compares with other fetch clients, and where it runs.

### When it fits, and when it doesn't

Need a normalized cache (update one user, and every screen showing that user updates), optimistic updates or subscriptions? Use Apollo or urql. Apollo's [caching overview](https://www.apollographql.com/docs/react/caching/overview) and urql's [Graphcache docs](https://nearform.com/open-source/urql/docs/graphcache/) explain how each one caches. [Why another API client?](#why-another-api-client) covers the trade-off.

For UI caching and refetching, use TanStack Query *with* liaise; see the [recipe](#use-with-tanstack-query).

For two or three calls, plain fetch is fine.

liaise is a good fit when you have:

- **Many endpoints with one auth setup.** Each endpoint is one [`defineRequest`](#defining-endpoints), and one [auth middleware](#add-an-auth-header-and-refresh-the-token-on-a-401) covers them all.
- **Failure handling that matters**, such as a checkout or a form. Every failure comes back as a value with a [kind you can switch on](#handling-errors).
- **One API layer shared across frameworks, servers and scripts.** See [Where it runs](#where-it-runs).

### How it compares

[`compare/`](https://github.com/iremlopsum/liaise/blob/main/compare) runs fetch, axios, ky, ofetch and liaise through ten failure scenarios against a local server, and records what the calling code gets back. [compare/README.md](https://github.com/iremlopsum/liaise/blob/main/compare/README.md) explains the fairness rules. If you maintain one of these libraries and think its setup is unfair, a pull request is welcome.

<!-- compare:start -->

Measured on 4 October 2026 against axios 1.20.0, ky 2.1.0 and ofetch 1.5.1. Other libraries change. Rerun it with `npm run build` in the repo root, then `npm install && npm run compare` in `compare/`. Run in Node 22.18.0 against a local server. In browsers axios uses XHR, so its results there can differ.

| Scenario | fetch | axios | ky | ofetch | liaise |
| --- | :-- | :-- | :-- | :-- | :-- |
| Server answers 500 | throws Error* | throws AxiosError | throws HTTPError | throws FetchError | error result (http) |
| Server unreachable | throws TypeError* | throws AxiosError (name: Error) | throws NetworkError | throws FetchError | error result (network) |
| Server never answers | throws TimeoutError, 3002 ms* | throws AxiosError, 3005 ms | throws TimeoutError, 3005 ms | throws FetchError, 3003 ms | error result (timeout), 3003 ms |
| 200 with broken JSON | throws SyntaxError* | throws AxiosError (name: SyntaxError) | throws SyntaxError | throws SyntaxError | error result (parse) |
| 204 with no body, on a JSON call | resolves with undefined* | resolves with "" | resolves with undefined | resolves with undefined | resolves with undefined |
| Search as you type: which results stay on screen | shows "rea"* | shows "rea"* | shows "rea"* | shows "rea"* | shows "rea" |
| Five requests get a 401 at once | 1 refresh call, 5/5 succeed* | 1 refresh call, 5/5 succeed* | 1 refresh call, 5/5 succeed* | 1 refresh call, 5/5 succeed* | 1 refresh call, 5/5 succeed* |
| Slow 503s, 3 s deadline, 3 retries: when does the caller hear back | after 3.0s: throws TimeoutError, 3 attempts* | after 3.0s: throws CanceledError, 3 attempts* | after 3.0s: throws TimeoutError, 3 attempts | after 3.0s: throws FetchError, 3 attempts* | after 3.0s: error result (timeout), 3 attempts |
| Path param is undefined | requests /s/users/undefined | requests /s/users/undefined | requests /s/users/undefined | requests /s/users/undefined | refused before sending: error result (network) |
| Response is missing a field the type promises | — | — | throws SchemaValidationError | — | error result (parse) |

\* needed hand-written code, described in the [notes](https://github.com/iremlopsum/liaise/blob/main/compare/results.md#notes). — means the library has no built-in option.

Out of the box, liaise has no timeout (only ky has one by default) and treats a 204 on a JSON call as a parse error. See Table B in [compare/results.md](https://github.com/iremlopsum/liaise/blob/main/compare/results.md).

| Library | gzip (kB) | brotli (kB) |
| --- | :-- | :-- |
| fetch | 0.1 | 0.1 |
| axios | 19.1 | 17.3 |
| ky | 9.6 | 8.5 |
| ofetch | 4.0 | 3.6 |
| liaise | 5.8 | 5.2 |
| liaise + retryMiddleware | 6.3 | 5.7 |

fetch is built into the runtime; its row is the call site only, the floor rather than a library.

Request overhead on localhost, sequential (median requests per second): fetch 16,797, axios 13,691, ky 13,742, ofetch 16,230, liaise 16,414.

Out-of-the-box results, request overhead in full and the notes: [compare/results.md](https://github.com/iremlopsum/liaise/blob/main/compare/results.md).

<!-- compare:end -->

With enough of your own code, every library gets the right result in almost every row. The difference is how much you write. Counting the cells marked `*`, fetch needs 8, axios 3, ofetch 3, ky 2 and liaise 1. liaise needs code only for the token refresh, and returns each failure as a value instead of throwing. It is the only one that refuses an undefined path param before sending the request.

ky is the closest alternative. Apart from throwing instead of returning errors, it differs from liaise in two rows of the table. Its search as you type needs code, and it sends the undefined path param. Out of the box, ky is the only one that times out, and it retries, as ofetch does. In size, liaise is larger than ofetch and smaller than ky and axios.

In request overhead, liaise ties fetch and ofetch. axios and ky handle about 16% fewer requests per second than liaise. Overhead is measured in microseconds; on a real network each request takes milliseconds.

### Where it runs

| Runtime | Status |
| ------- | ------ |
| Node 20, 22, 24 | Tested in CI |
| Browsers, Bun, Deno, Cloudflare Workers | Should work (standard `fetch`), not tested in CI |
| React Native | Uses its built-in `fetch`, not tested in CI |

On React Native, where `AbortSignal.timeout` is missing, `timeout` falls back to a timer. If the runtime drops abort reasons, a timeout may report as `'abort'` instead of `'timeout'`.

No hooks, no framework code: a client is a plain object of functions returning promises. It works in React, Vue, Svelte, Solid, Angular, server loaders, workers and scripts. The [recipes](#recipes) show it with TanStack Query, React and a store.

## Design principles

### Never throws

A thrown error doesn't show up in a function's type, so nothing reminds you to catch it, and one missed `try` breaks the page. A returned error is part of the type. TypeScript makes you check `error` before you can read `data`, and every failure arrives in the same shape.

### Zero dependencies

Every dependency of liaise would also be a dependency of your app, with more to download, audit and update. liaise uses only what the runtime already has: `fetch`, `Headers`, `AbortController` and the other web types. Validators plug in through Standard Schema, which is only an interface, so schema support adds no package either. The size of each entry point is under [Exports](#exports).

### Middleware over interceptors

Separate request and response interceptors split one job in two. State both halves need rides on the request config, and resending means calling the client again from inside a hook. A middleware wraps the whole call, so one function can set a header, read the result, retry, or answer from a cache. The built-in retry, cache and log are ordinary middleware, so anything they do, yours can do too.

### Types by inference

Types you write at each call site drift away from the endpoint they describe. In liaise you write the types once, on the endpoint, and the path supplies the path params. `createApi` carries them to every call, so a renamed param or a changed response is a compile error where it is used.

### Any runtime

liaise needs only `fetch` and the standard web types, so one client works in a browser, on a server, in a worker or in a script. Code that moves between them needs no second client and no adapter. [Where it runs](#where-it-runs) lists what CI tests.

### Any framework

A client is a plain object of functions that return promises. That fits every UI framework, and code with no framework at all, and there is nothing to rewrite when you switch. Query libraries expect a failed call to throw, so you convert at that one edge, as the [TanStack Query recipe](#use-with-tanstack-query) does.

## Reference

Every option, type and export, read from the source. The guide explains when to use each one.

### createApi options

`createApi(config)` takes an `ApiConfig`.

| Option | Type | Default | What it does |
| ------ | ---- | ------- | ------------ |
| `baseUrl` | `string` | required | Goes in front of every endpoint's path. It may carry a query string ([details](#baseurl-query-merging)). |
| `requests` | an object of endpoints | required | Each key becomes a method on the client, such as `api.getUser`. |
| `middleware` | `Middleware[]` | — | Runs on every call, before endpoint and call middleware. |
| `headers` | `HeadersInit` | — | Sent with every call. An endpoint or a call can replace a header ([three levels](#three-levels-of-settings)). |
| `timeout` | `number` (ms) | no deadline | A deadline for every call. An endpoint or a call can set its own, and `0` there turns it off ([details](#set-a-deadline-with-timeout)). |
| `log` | `boolean \| LogOptions` | off | Logs every call to the console ([Log every call](#log-every-call), [options](#log-options)). |
| `onError` | `(error: ApiError) => void` | — | Called once per failed call, after all middleware. Calls that share one failed request count as one. Never for `'abort'` ([details](#reporting-errors-with-onerror)). |

### createGraphQL options

`createGraphQL(config)` takes a `GraphQLBaseConfig`, plus either `operations` or `queries` and `mutations` ([Queries and mutations](#queries-and-mutations)).

| Option | Type | Default | What it does |
| ------ | ---- | ------- | ------------ |
| `endpoint` | `string` | required | The full URL of the GraphQL endpoint. |
| `middleware` | `Middleware[]` | — | Runs on every operation, before operation and call middleware. |
| `headers` | `HeadersInit` | — | Sent with every operation. An operation or a call can replace a header. |
| `timeout` | `number` (ms) | no deadline | A deadline for every operation. An operation or a call can set its own, and `0` there turns it off. |
| `log` | `boolean \| LogOptions` | off | Logs every call to the console ([Log every call](#log-every-call), [options](#log-options)). |
| `onError` | `(error: ApiError) => void` | — | Called once per failed call, GraphQL errors included. Calls that share one failed request count as one. Never for `'abort'`. |

### Endpoint options

`defineRequest<T>()(config)` and `new Request(config)` take a `RequestConfig`.

| Option | Type | Default | What it does |
| ------ | ---- | ------- | ------------ |
| `method` | `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'` | required | The HTTP method. |
| `path` | `string` | required | The path after `baseUrl`. Each `:name` is filled from the params ([Defining endpoints](#defining-endpoints)). |
| `middleware` | `Middleware[]` | — | Runs on every call to this endpoint, after client middleware. |
| `headers` | `HeadersInit` | — | Sent with every call to this endpoint. Replaces the client's value for the same header. |
| `responseType` | `'json' \| 'text' \| 'blob' \| 'arrayBuffer' \| 'formData' \| 'none'` | `'json'` | How the response body is read ([Reading responses](#reading-responses)). |
| `schema` | `StandardSchemaV1` | — | Checks a 2xx body, and `data` becomes the schema's output ([Validating responses](#validating-responses)). |
| `dedupe` | `boolean` | `false` | A new call cancels the one still running ([details](#drop-stale-calls-with-dedupe)). |
| `share` | `boolean` | `false` | Calls that would send the identical request share one network request ([details](#sharing-identical-requests)). Can't be combined with `dedupe`. |
| `bodyAs` | `'query' \| 'body'` | `'query'` for `GET` and `DELETE`, `'body'` for the rest | Where the params that aren't in the path go. |
| `timeout` | `number` (ms) | the client's `timeout` | One deadline for the whole call, retries included. Replaces the client's, and `0` turns it off ([details](#set-a-deadline-with-timeout)). |

### Operation options

`new Operation(config)` takes an `OperationConfig`.

| Option | Type | Default | What it does |
| ------ | ---- | ------- | ------------ |
| `operation` | `string` | required | The GraphQL document, sent as `query` in the body. |
| `middleware` | `Middleware[]` | — | Runs on every call to this operation, after client middleware. |
| `headers` | `HeadersInit` | — | Sent with every call to this operation. Replaces the client's value for the same header. |
| `dedupe` | `boolean` | `false` | A new call cancels the one still running. |
| `share` | `boolean` | `false` | Calls that would send the identical request share one network request ([details](#sharing-identical-requests)). Variables must match exactly, key order included. Can't be combined with `dedupe`. |
| `schema` | `StandardSchemaV1` | — | Checks the response's `data`. The response type stays explicit ([Validating responses](#validating-responses)). |
| `timeout` | `number` (ms) | the client's `timeout` | One deadline for the whole call, retries included. Replaces the client's, and `0` turns it off. |

### CallOptions

The second argument of every call, as in `api.getUser(params, options)`. [`paginate`](#pagination) takes the same options and applies them to every page.

| Option | Type | Default | What it does |
| ------ | ---- | ------- | ------------ |
| `middleware` | `Middleware[]` | — | Runs after the client's and the endpoint's middleware. Under `share`, what it changes in the request is part of what is compared. |
| `skipMiddleware` | `Middleware[]` | — | Middleware to leave out of this call, matched by reference ([details](#skipping-a-middleware-for-one-call)). |
| `headers` | `HeadersInit` | — | Replaces the client's and the endpoint's value for the same header. Under `share` they are part of what is compared, so identical per-call headers share. |
| `signal` | `AbortSignal` | — | Cancels the call, which ends with `kind: 'abort'` ([details](#cancel-with-a-signal)). |
| `timeout` | `number` (ms) | the endpoint's `timeout`, else the client's | Replaces the endpoint's and the client's deadline for this call. `0` turns it off. Under `share`, it bounds only this caller's wait ([details](#sharing-identical-requests)). |

A fractional `timeout` is rounded down to whole milliseconds, with a minimum of 1 ms. A value above the timer limit of 2³¹ − 1 ms is capped there. Zero or a negative number means no deadline.

### getHeaders()

Every method on a client has `getHeaders()`, which returns the headers its endpoint sends from configuration. Those are the client's headers merged with the endpoint's, with the endpoint's winning, and every name is lowercase.

```ts
import { createApi, defineRequest } from 'liaise'

const api = createApi({
  baseUrl: 'https://api.example.com',
  headers: { 'X-Api-Version': '1', 'X-Client': 'web' },
  requests: {
    getUser: defineRequest<{ id: string }>()({
      method: 'GET',
      path: '/users/:id',
      headers: { 'X-Api-Version': '2' },
    }),
  },
})

api.getUser.getHeaders() // { 'x-api-version': '2', 'x-client': 'web' }
```

- **It leaves out per-call headers, headers a middleware sets, and the `Content-Type` liaise picks from the body.** Those exist only once a call happens.
- **It returns a new plain object each time.** Changing it changes nothing.
- **GraphQL operations have it too**, including `graphql.query.getCategory.getHeaders()` and `graphql.mutation.updateCategory.getHeaders()` on a client split into queries and mutations.

### Result and ApiError

Every call returns a `Result`. `data` and `error` are never both set, so checking `error` narrows `data`.

```ts
interface SuccessResult<TResponse> {
  data: TResponse
  error: null
  response: Response                       // always present on success
  retry: () => Promise<Result<TResponse>>
}

interface ErrorResult<TResponse> {
  data: null
  error: ApiError
  response: Response | null                // null when no response arrived
  retry: () => Promise<Result<TResponse>>
}

type Result<TResponse> = SuccessResult<TResponse> | ErrorResult<TResponse>
```

`response` is set for `'http'` and `'parse'` errors, where the server answered. It is `null` for `'network'`, `'abort'`, `'timeout'` and `'middleware'`.

`ApiError` is the `error` of a failed call. It is a plain class and doesn't extend `Error`.

| Property | Type | What it holds |
| -------- | ---- | ------------- |
| `kind` | `ApiErrorKind` | What went wrong. The [kinds table](#handling-errors) says what each one means. If you build an `ApiError` yourself, for example in a middleware, `kind` is required. |
| `status` | `number` | The response's status for `'http'` and `'parse'`. `0` for `'network'`, `'abort'`, `'timeout'` and `'middleware'`. |
| `statusText` | `string` | The response's status text, `'GraphQL Error'` for a GraphQL error, and `''` when no response arrived. |
| `body` | `unknown` | For `'http'`, the error body, or `null` when it is empty or doesn't parse. For `'parse'`, what the [Validating responses](#validating-responses) and [Reading responses](#reading-responses) rules say. Otherwise, the thrown value. |
| `headers` | `Headers` | The response headers. Empty when no response arrived. |
| `request` | `{ method, url, params }` | The failed request. `url` is the address with the params filled in. It is the path template only when the URL couldn't be built. |
| `partialData` | `unknown` (optional) | For a GraphQL error, the data the server sent with the errors. `undefined` for every REST error. |

```ts
type ApiErrorKind = 'http' | 'network' | 'abort' | 'timeout' | 'parse' | 'middleware'
```

You can check for an `ApiError` with `instanceof`:

```ts
import { ApiError } from 'liaise'

if (error instanceof ApiError) {
  console.error(error.kind, error.status)
}
```

### MiddlewareContext

The first argument of every middleware, `ctx`:

| Property | Type | What it holds |
| -------- | ---- | ------------- |
| `request.method` | `string` | The HTTP method, such as `'GET'`. |
| `request.url` | `string` | The full URL, with path params and query string filled in. |
| `request.path` | `string` | The path template, such as `'/users/:id'`. |
| `request.params` | `unknown` | The params as the caller passed them. |
| `request.headers` | `Headers` | The merged headers. A middleware can add, change or remove them. |
| `request.body` | `unknown` | The serialized body, or `null` when there is none. |
| `request.signal` | `AbortSignal \| undefined` | The signal `fetch` receives. Under `share` it is the signal this caller waits on, because the shared request has its own. A middleware can replace it ([Signals in middleware](#signals-in-middleware)). |
| `requestName` | `string` | The endpoint's key, such as `'getUser'`. |

How a replaced signal works with `share` and `dedupe` is under [Signal-replacing middleware](#signal-replacing-middleware).

### Built-in middleware options

#### RetryOptions

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

#### Cache options

`cacheMiddleware(options)` returns a middleware with a `clear()` method, typed `CacheMiddleware`.

| Option | Type | Default | What it does |
| ------ | ---- | ------- | ------------ |
| `ttl` | `number` (ms) | `300000` (5 minutes) | How long an entry is served. An expired entry is removed when it is next read. |
| `maxSize` | `number` | `50` | How many entries the store keeps. When it is full, the oldest entry is dropped. |
| `debug` | `boolean` | `false` | Logs `[liaise cache] HIT` or `MISS`, with the endpoint and its params, to the console. |

What goes into the key is under [Cache key](#cache-key).

#### Log options

The `log` option of both clients takes a boolean or a `LogOptions`, and `logMiddleware(options)` takes a `LogOptions`. `log: true` and a bare `logMiddleware` mean `{ enabled: true, data: false }`.

| Option | Type | Default | What it does |
| ------ | ---- | ------- | ------------ |
| `enabled` | `boolean` | `true` | Turns logging on or off. With `false`, `log` installs nothing and `logMiddleware` passes every call straight through. |
| `data` | `boolean` | `false` | Also prints each call's data, or its `error.body` on failure. An object or array goes to `console.table`, anything else to `console.log`, which is also used where `console.table` is missing. |

Each call logs one line when it starts and one when it ends:

```text
[liaise] → <method> <endpoint> <url>
[liaise] ← <endpoint> OK (<ms>ms)
[liaise] ← <endpoint> ERROR <status> (<ms>ms)
[liaise] ← <endpoint> OK (<ms>ms, shared)
```

The time covers everything that runs inside the logger. For `log` that is the whole call, and for `logMiddleware` it is the middleware after it and the request. An error with no response logs status `0`. A console that throws never fails the call.

### liaise/testing

| Export | Kind | What it is |
| ------ | ---- | ---------- |
| `mockFetch` | function | Builds a `fetch` stub that matches routes, with `install()`, `restore()`, call recording and response sequences. |
| `jsonResponse` | function | Builds a `Response` with a JSON body and a `content-type` header. |
| `successResult` | function | Builds a success `Result`, for stubbing at the `Result` level. |
| `errorResult` | function | Builds an error `Result` with a given HTTP status, for stubbing at the `Result` level. |
| `RouteContext` | type | `{ params, request }`, passed to a route function. |
| `RouteHandler` | type | `(ctx: RouteContext) => Response \| Promise<Response>`, a route value that builds its response. |
| `RouteValue` | type | `Response \| RouteHandler \| Array<Response \| RouteHandler>`, anything a route key can map to. |
| `RecordedCall` | type | `{ method, url, headers, body }`, one entry in `mock.calls`. |

How the stub behaves, beyond [Testing your code](#testing-your-code):

- **It honours `init.signal`, like real `fetch`.** A signal that is already aborted, or aborts while a route function is still pending, rejects with its `reason`. So a route that never answers, `() => new Promise(() => {})`, lets you test your own `timeout` and cancel handling.
- **An aborted call is still recorded** in `calls` and counted by `callCount`, but it doesn't use up a response from a sequence.
- **`restore()` puts back whatever `globalThis.fetch` was when `install()` ran.** If it was `undefined`, `restore()` puts back `undefined`.
- **A route key without a space**, such as `'/users'`, throws when you call `mockFetch`, and the message names the key.
- **Routes are tried in the order you wrote them**, and the first match wins. Put the more specific route first when two could match the same path.
- **Trailing and doubled slashes are ignored on both sides.** `/a/b/`, `/a//b` and `/a/b` all match the same route.

### Exports

Each entry point is a separate import, and your bundler leaves out what you don't import. Gzipped, as measured by `npm run size`: about 5.8 kB for a REST-only import, 6.9 kB for the whole core entry, and 8.0 kB with all the middleware.

**`liaise`**

| Export | Kind | What it is |
| ------ | ---- | ---------- |
| `createApi` | function | Creates a REST client from your endpoints. |
| `defineRequest` | function | Defines an endpoint, with params checked against the path. |
| `Request` | class | The endpoint class that `defineRequest` builds ([Without defineRequest](#without-definerequest)). |
| `paginate` | function | Walks a paginated endpoint, one `Result` per page. |
| `ApiError` | class | The `error` of a failed call. |
| `createGraphQL` | function | Creates a GraphQL client from your operations. |
| `Operation` | class | Defines one GraphQL operation. |
| `gql` | function | Marks a template string as GraphQL for your editor, and returns it as a plain string. |
| `Result`, `SuccessResult`, `ErrorResult` | type | What every call returns, and its two branches. |
| `ApiErrorKind` | type | The union of `error.kind` values. |
| `CallOptions` | type | The second argument of a call. |
| `PaginateOptions` | type | `next`, `maxPages`, and any `CallOptions`. |
| `ApiConfig`, `RequestConfig` | type | The configs of `createApi` and an endpoint. |
| `LogOptions` | type | The options of `log` and `logMiddleware(options)` ([Log options](#log-options)). |
| `GraphQLBaseConfig`, `OperationConfig` | type | The configs of `createGraphQL` and an `Operation`. |
| `GraphQLError` | type | One entry of a GraphQL `errors` array. |
| `Middleware`, `MiddlewareContext`, `MiddlewareNext` | type | A middleware, its `ctx`, and its `next`. |
| `StandardSchemaV1`, `InferOutput`, `StandardIssue` | type | The Standard Schema interface, the type a schema produces, and one validation issue. |

**`liaise/middleware`**

| Export | Kind | What it is |
| ------ | ---- | ---------- |
| `retryMiddleware` | function | Returns a middleware that retries failed calls ([RetryOptions](#retryoptions)). |
| `cacheMiddleware` | function | Returns a middleware that caches successes in memory ([Cache options](#cache-options)). |
| `logMiddleware` | middleware | Logs each call to the console. Use it as it is, or call it with options ([Log options](#log-options)). |
| `RetryOptions`, `RetryInfo` | type | The options of `retryMiddleware`, and the argument to `onRetry`. |
| `CacheMiddleware` | type | What `cacheMiddleware()` returns, a `Middleware` with `clear()`. |
| `LogMiddleware` | type | The type of `logMiddleware`, a `Middleware` you can also call with `LogOptions`. |

**`liaise/testing`** exports are listed under [liaise/testing](#liaisetesting).

### Behaviour in detail

Edge cases the guide links to.

#### Cache key

`cacheMiddleware` keys each entry on the endpoint name, the method, the full URL, the params and every request header except `Content-Type`. A different `Authorization`, base URL or query value gets its own entry.

The query string is sorted by name before it goes in the key, so `?a=1&b=2` and `?b=2&a=1` are one entry. It is sorted by the raw, undecoded name, and repeated names keep their order. A query param that a middleware adds before the cache, such as `?lang=de`, is part of the key.

Params are keyed by content. Object keys are sorted, and an `undefined` member is dropped, so `{ a: undefined }` and `{}` match. A value with a `toJSON` method is keyed by what it returns, so a `Date` is its ISO string. A `Map`, `Set` or typed array is keyed by its entries.

A call is never cached, and never served from the cache, when its params hold any of these, at any depth:

- a BigInt
- a function or a symbol
- an `ArrayBuffer`, `Blob`, `FormData` or `URLSearchParams`
- a boxed primitive, such as `new String('a')`
- a circular structure
- an object with no enumerable keys that isn't a plain object, such as an `Error`, a `Promise`, or a class instance that keeps its state in private fields

Each `cacheMiddleware()` call makes its own store, so two stores never share entries.

#### Share key and refcount

Under `share`, two calls join one request when all of these match. They are read as the request is about to be sent, after every middleware has run.

- The endpoint's name. Two endpoints can hit one URL with a different `responseType` or schema.
- The method and the full URL, query string included, exactly as sent.
- Every header, by lowercase name, except the tracing headers below.
- The body, when it is absent, a string (every JSON body is one) or `URLSearchParams`. Any other body has no key, so that call sends its own request.

The tracing headers are `traceparent`, `tracestate`, `baggage`, `sentry-trace`, `x-request-id` and `x-correlation-id`. They identify a request for tracing and don't change the answer. `baggage` can carry tenant or user IDs, and two calls that differ only there still share. Auth headers and cookies always stay in the key.

The response is read once, and each caller decodes its own copy, so each has its own `data` for JSON and text. A `Blob`, `ArrayBuffer` or `FormData` result is handed to every caller as the same object, because copying it would cost the bytes `share` saves.

Each caller holds a place in the shared request, counted by a refcount. A caller whose own `signal` or deadline fires gives up its place and stops waiting. When the last caller gives up, the request is aborted. Nobody is left to receive that abort, so it is never reported.

The shared request's deadline is the endpoint's `timeout`, or the client's when the endpoint has none, counted from when the request was sent. A caller that joins late can't extend it, and `timeout: 0` on one call can't turn it off. If each new caller restarted it, a steady stream of callers could keep one request open forever.

Every caller that runs out of the endpoint's or the client's `timeout` while it waits counts as one failure, and `onError` hears about it once. If the shared request then fails another way for callers still waiting, such as with a 500, that failure is reported too. A per-call `timeout` is its caller's own, and is reported on its own.

A retry from `retryMiddleware` is a new attempt. It joins an identical attempt in flight at that moment, and otherwise sends its own. Nothing is kept between attempts. Each caller's `result.retry()` runs that caller's own call again, with its own options.

#### Signal-replacing middleware

A middleware can replace `ctx.request.signal`, as [Give each attempt its own timeout](#give-each-attempt-its-own-timeout) shows.

Under `share`, the shared request is sent with a signal of its own. It fires only when every caller has given up or the shared deadline passes. A caller's own signal or deadline, and a signal its middleware installed, each release only that caller, whichever fires first. So a replaced signal that never fires can't keep a caller waiting past its own cancel.

Under `dedupe`, liaise merges the dedupe signal into yours, so the request ends when either one fires. The dedupe signal is added when `fetch` is called. A middleware that reads `ctx.request.signal` before `next()` sees only the caller's signal and the deadline.

#### Timeout backstop

A middleware may wait on work of its own before it calls `next()`, such as a token refresh. If that work never settles, the call still ends at its deadline. Here `user` stands for your auth client:

```ts
const auth: Middleware = async (ctx, next) => {
  const token = await user.getIdToken() // stalls on a bad network
  ctx.request.headers.set('Authorization', `Bearer ${token}`)
  return next()
}
// With timeout: 45_000, the call still settles after about 45 s: kind 'timeout', status 0.
```

When the deadline passes, the chain gets one macrotask to answer on its own. That is enough for anything that already reacts to the abort: `fetch` rejecting, a middleware rethrowing the reason, or a fallback that turns a timeout into a cached response. Each of those keeps its own `Result`.

A chain still waiting after that is stuck on something the signal doesn't reach. The call then settles with `kind: 'timeout'` and `status: 0`, and `onError` is called once. A caller's `signal` works the same way, with `kind: 'abort'`, which `onError` never sees.

The stuck middleware keeps running, because a promise can't be cancelled. Whatever it returns or throws later is discarded, with no second `Result` and no second `onError`. If it calls `next()` after the call has settled, nothing is sent, and `next()` returns the `Result` the caller already has.

#### Abort classification

liaise decides whether a failure is a cancellation by checking whether this call's own signal aborted. The thrown value's name and type don't matter. A custom reason, such as `controller.abort(new Error('unmounted'))` or a plain string, still gives `kind: 'abort'`, and a deadline gives `'timeout'`.

A middleware that rethrows liaise's own abort or timeout reason, as it is or wrapped once as the `cause` of another error, gives `'abort'` or `'timeout'` too. Anything else a middleware throws is `'middleware'`.

#### baseUrl query merging

A `baseUrl` can carry its own query string, such as a fixed `api-version`. Its params go in front of the call's:

```ts
import { createApi, defineRequest } from 'liaise'

type Hit = { id: string }

const search = defineRequest<Hit[], { q: string }>()({ method: 'GET', path: '/search' })
const api = createApi({ baseUrl: 'https://api.example.com/v1?api-version=2', requests: { search } })

await api.search({ q: 'hello' })
// GET https://api.example.com/v1/search?api-version=2&q=hello
```

A key that appears in both is sent twice. A call param named `api-version` gives `?api-version=2&api-version=3`, and the server decides which one counts. Headers merge by name, but query params can't, because an array param is already sent as repeated keys (`tags=a&tags=b`). To change a base param on each call, set it in a middleware.

The full URL, base query included, appears in `ctx.request.url`, `error.request.url` and the [log](#log-every-call) output, so anything that logs or reports it sends that query too. Put a secret in a header instead.

#### URL fragments

A `#` written into a `path` or a `baseUrl` is refused, because a fragment is never sent to the server. The call returns an error with `kind: 'network'` and a `TypeError` in `error.body` that names the value. Nothing is sent. liaise refuses the fragment instead of stripping it, so the dead part doesn't stay in your code.

`defineRequest` also refuses a fragment in a `path` literal, at compile time:

```ts
defineRequest<Doc>()({ method: 'GET', path: '/docs#section' })
//                                          ^ Property '__fragmentInPath' is missing:
//                                            a URL fragment is never sent to the server
```

The check reads the literal. A path built at runtime, or a variable typed as `RequestConfig`, still compiles and is refused when it is called. `new Request` has no compile-time check.

A `#` inside a param value is data. It is escaped to `%23` and sent:

```ts
await api.getDoc({ id: 'a#b' })   // GET /docs/a%23b
await api.search({ tag: 'a#b' })  // GET /search?tag=a%23b
```

#### Stream bodies

A `ReadableStream` body is used up as it is sent, so liaise can't send it again. A second attempt, from `retryMiddleware` or `result.retry()`, returns `kind: 'network'` and `status: 0`, with a `TypeError` that tells you to read the stream into a `Blob` or `ArrayBuffer` first. Under `retryMiddleware` that error is the final `Result`, so the 5xx that caused the retry isn't in it.

#### Empty bodies

- **A 2xx with an empty body under `'json'`** is a `'parse'` error ([Reading responses](#reading-responses)), and its `Result` still has `retry()`.
- **A non-2xx with an empty body** is an ordinary `'http'` error with `error.body` set to `null`. So is a non-2xx whose JSON body doesn't parse, such as an HTML page from a gateway. Nobody promised a body on failure, so neither is a `'parse'` error.
- **On GraphQL**, a 2xx with neither `data` nor `errors` is a `'parse'` error with the raw text in `error.body` ([GraphQL errors](#graphql-errors)). That includes a root of `null`, a number or an array. Each is valid JSON, but GraphQL requires an object.

## Upgrading, contributing, licence

- **Upgrading.** [MIGRATION.md](./MIGRATION.md) says what to change when an upgrade needs it. [CHANGELOG.md](./CHANGELOG.md) lists every release.
- **Contributing.** Bug reports, fixes and ideas are welcome. [CONTRIBUTING.md](./CONTRIBUTING.md) explains how to report a bug, run the tests, and the few rules a pull request is checked against.
- **Licence.** MIT, in [LICENSE](./LICENSE).
