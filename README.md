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
- [REST API](#rest-api)
- [GraphQL Client](#graphql-client)
- [Testing](#testing)
- [Philosophy](#philosophy)
- [API Reference](#api-reference)
- [Contributing](#contributing)
- [License](#license)

## The problem it solves

`fetch` is a good building block. Every project still ends up writing the same few things around it, and they are easy to get subtly wrong.

| With plain fetch | liaise | See |
| ---------------- | ------ | --- |
| Typing fast in a search box shows old results. A slow early search lands last. | `dedupe` cancels the older call. | [Stale requests](#cancelling-deadlines-and-stale-requests) |
| Five components load the same data, or five 401s each refresh the token. That's five identical requests. | `share` sends one and hands everyone the answer. | [Sharing requests](#quick-start) |
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
- [Add an auth header and refresh the token on a 401](#quick-start)
- [Use with TanStack Query](#quick-start)
- [Use with React](#quick-start)

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
- That catches the most common mistake: calling before an id has loaded. `getItem({ id: undefined })` returns an error instead of fetching `/items/undefined`.
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

| `kind` | What happened | `status` | What you usually do | Reported to `onError`? |
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
- **A non-2xx response is always `'http'`**, even when its body doesn't parse. liaise checks the status before it reads the body, so a 500 with broken JSON is still a 500.
- **`response` is for the status and headers.** liaise has already read its body to produce `data` or `error.body`, so `response.json()` throws "Body has already been read". A `Response` you build yourself for `successResult()` in tests keeps its body.
- Every field of `error` is listed under [`ApiError`](#apierror).

#### Trying again with retry()

Every `Result` carries `retry()`, which runs the same call again. It goes through all your middleware, so an auth header is set again and logging runs again:

```ts
const { error, retry } = await api.getUser({ id: '42' })

if (error?.status === 401) {
  await refreshToken()
  const second = await retry() // a fresh call through every middleware
}
```

#### Reporting errors with onError

`onError` on `createApi` is one place to send every error to your tracker.

```ts
const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUser },
  onError: (error) => logToTracker(error),
})
```

- It runs once per call, after all your middleware has finished. A call that a retry middleware rescues from a 500 never reaches it.
- It isn't called for `'abort'`. A cancellation you asked for isn't a failure. A `'timeout'` is reported, because it's a deadline you missed.
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
import { retryMiddleware } from 'liaise/middleware'

type Report = { total: number }

const getReport = defineRequest<Report>()({ method: 'GET', path: '/report', timeout: 3000 })

const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getReport },
  middleware: [retryMiddleware(3)],
})

const { error } = await api.getReport()
// After 3 seconds, however many retries are left: error.kind === 'timeout', error.status === 0
```

- **`timeout` is one deadline for the whole call.** It covers every middleware, every retry and every wait between retries. `timeout: 3000` with three retries still answers within three seconds.
- **A call's `timeout` replaces the endpoint's.** `timeout: 0` on a call turns the endpoint's deadline off. Zero, a negative number or no `timeout` at all means no deadline, which is the default.
- **`result.retry()` starts a fresh deadline.** The retried call isn't charged for time the first one used.
- If you want a separate limit for each attempt instead, see [Per-attempt timeout](#per-attempt-timeout).
- Under [`share`](#sharing), the endpoint's `timeout` belongs to the one shared request, and a caller can't extend it.

#### Drop stale calls with dedupe

`dedupe: true` makes each new call to an endpoint cancel the one still running. Use it for search-as-you-type and fast-changing filters, where only the latest answer matters:

```ts
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
- **A replaced call ends with `kind: 'abort'`**, so your code can ignore it, and it isn't reported to `onError`.
- **It works together with your own signal and a `timeout`.** Whichever fires first ends the call.
- It can't be combined with [`share`](#sharing), which does the opposite.

All three still end the call when a middleware is stuck on work of its own that ignores the signal, such as a token refresh that never settles. [Timeout backstop](#timeout-backstop) explains how.

## REST API

#### `share`

When `true`, identical concurrent calls to this endpoint join a single in-flight request instead of firing their own. See [Sharing](#sharing) for the full contract — including its mutual exclusion with `dedupe` and what disables it.

```ts
const getProduct = new Request<{ id: string }, Product>({
  method: 'GET',
  path: '/products/:id',
  share: true
})

// Both calls join the same network request
await Promise.all([
  api.getProduct({ id: '42' }),
  api.getProduct({ id: '42' })
])
```

### Pagination

`paginate` walks a paginated endpoint, yielding one `Result` per page:

```ts
import { paginate } from 'liaise'

for await (const page of paginate(api.listItems, { limit: 50 }, {
  next: (p, prev) => p.data.cursor ? { ...prev, cursor: p.data.cursor } : undefined,
})) {
  if (page.error) break
  render(page.data.items)
}
```

**`next` returns the next params, not a cursor.** That is what keeps this
library out of the business of guessing where a cursor goes — `cursor`?
`page_token`? `after`? The previous params arrive as the second argument, so
the common case is a spread, and the same shape covers every scheme:

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

Return `undefined` or `null` to stop.

**An error page is yielded, then the walk ends.** There is no data to read the
next cursor from, so there is nothing to continue with — and you see what
failed rather than a loop that quietly stopped.

**`maxPages` is optional and has no default.** A ceiling exists if you want one;
the library will not invent a number, because a silent truncation at an
arbitrary limit looks exactly like reaching the last page.

```ts
paginate(api.listItems, { limit: 50 }, { next, maxPages: 100 })
```

Any other [`CallOptions`](#core-liaise) — `signal`, `timeout`, `headers` — apply
to every request, so one signal cancels the whole crawl.

`paginate` yields pages, not items. Flattening would mean deciding which field
holds the array, which is the convention-guessing `next` exists to avoid.

### Middleware

Middleware follows the onion model (like Koa or Redux middleware). Each middleware wraps the next layer, can modify the request going in and the result coming out.

```
Request → [Global MW → [Per-request MW → [Per-call MW → [fetch]]]]
```

A middleware function receives a `context` and a `next` function:

```ts
import type { Middleware } from 'liaise'

const authMiddleware: Middleware = async (ctx, next) => {
  // Before: modify the request
  ctx.request.headers.set('Authorization', `Bearer ${getToken()}`)

  // Call the next layer
  const result = await next()

  // After: inspect or transform the result
  return result
}
```

#### What middleware can do

- **Modify the request** -- set headers, change the body, rewrite the URL.
- **Short-circuit** -- return early without calling `next()` (e.g., serve from cache).
- **Retry** -- call `next()` multiple times in a loop (e.g., retry on 5xx).
- **Inspect the result** -- log, report errors, transform response data.

#### Three layers

Middleware is applied at three levels. The execution order is global first, per-request second, per-call third:

```ts
// Global -- applies to every endpoint
const api = createApi({
  baseUrl: '/api',
  requests: { getUser, createUser },
  middleware: [authMiddleware, logMiddleware]
})

// Per-request -- applies only to this endpoint
const getUser = new Request<{ id: string }, User>({
  method: 'GET',
  path: '/users/:id',
  middleware: [cacheMiddleware]
})

// Per-call -- applies only to this single invocation
await api.getUser({ id: '42' }, {
  middleware: [customTraceMiddleware]
})
```

#### `skipMiddleware`

Remove specific middleware for a single call by passing references to `skipMiddleware`:

```ts
const retry = retryMiddleware(3)

const api = createApi({
  baseUrl: '/api',
  requests: { getUser },
  middleware: [retry, logMiddleware]
})

// Skip retry for this one call
await api.getUser({ id: '42' }, {
  skipMiddleware: [retry]
})
```

Comparison is by reference (`===`). Factory-style middleware like `retryMiddleware(3)` must be stored in a variable first -- calling the factory again creates a new reference that will not match.

#### `MiddlewareContext`

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

`request.signal` holds the call's own signal: the caller's `options.signal` merged with any `timeout` (and, under `share: true`, with the refcount that aborts the shared request once every sharer has given up). It is `undefined` only when there is none of those. The core fetch reads the field at call time, so replacing it takes effect -- that is all a timeout middleware needs:

```ts
const timeout = (ms: number): Middleware => async (ctx, next) => {
  ctx.request.signal = AbortSignal.timeout(ms)
  return next()
}

const api = createApi({
  baseUrl: '/api',
  requests: { getUser },
  middleware: [timeout(5000)]
})
```

Under `dedupe: true` your signal is merged rather than discarded: the request is cancelled by whichever fires first -- your signal, or a newer call superseding this one. The dedupe signal is installed by the core fetch, so middleware reading `ctx.request.signal` before `next()` sees the caller's signal, not the dedupe one.

**Pass `ctx.request.signal` on to any async work your middleware does itself** -- a token refresh, a lookup, a queue. The library will not wait for that work past the call's deadline or the caller's abort either way (see [Timeout backstop](#timeout-backstop)), but a promise cannot be cancelled from outside: handing it the signal is the only thing that actually *stops* the work, instead of leaving it running in the background with its result discarded.

#### Writing custom middleware

A cache middleware that short-circuits on cache hits:

```ts
const cacheMiddleware: Middleware = async (ctx, next) => {
  const cached = cache.get(ctx.request.url)
  if (cached) return cached

  const result = await next()

  if (result.data) {
    cache.set(ctx.request.url, result)
  }

  return result
}
```

An error reporting middleware:

```ts
const sentryMiddleware: Middleware = async (ctx, next) => {
  const result = await next()

  if (result.error && result.error.status >= 500) {
    Sentry.captureMessage(`API error: ${ctx.request.method} ${ctx.request.url}`, {
      extra: { status: result.error.status, body: result.error.body }
    })
  }

  return result
}
```

#### Built-in middleware

The library ships three optional middleware functions, importable from a separate entry point:

```ts
import { retryMiddleware, logMiddleware, cacheMiddleware } from 'liaise/middleware'
```

**`retryMiddleware(options?: number | RetryOptions)`**

Automatically retries requests that fail, with a real backoff policy — exponential (or linear, or custom) delay curves, full jitter, `Retry-After` support, a configurable retry predicate, and an observational `onRetry` hook.

The numeric shorthand still works exactly as before — `retryMiddleware(2)` retries up to 2 additional times (3 total attempts) on a 5xx response:

```ts
const api = createApi({
  baseUrl: '/api',
  requests: { getItems },
  middleware: [retryMiddleware(2)]
})
```

By default, only server errors (`status >= 500`) are retried. Client errors (4xx), 429, and network errors (`status: 0`) are not — see the opt-in recipes below.

**Retry policy**

Pass a `RetryOptions` object instead of a number for full control:

```ts
const api = createApi({
  baseUrl: '/api',
  requests: { getItems },
  middleware: [retryMiddleware({
    max: 5,
    delay: 'exponential',
    baseDelay: 250,
    maxDelay: 10_000,
    jitter: true,
    respectRetryAfter: true,
    onRetry: ({ attempt, max, delay }) => console.log(`retry ${attempt}/${max} in ${delay}ms`),
  })],
})
```

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

**429 and network-error opt-in.** Both are deliberately excluded from the default `retryOn` — retrying a rate limit or a network failure by default would change behavior under existing callers on upgrade. Opt in explicitly:

```ts
// Retry 429 in addition to 5xx
retryMiddleware({
  retryOn: r => r.error?.status === 429 || (r.error?.status ?? 0) >= 500
})

// Retry network errors (status 0) too — but not aborts, which are also status 0
retryMiddleware({
  retryOn: r => (r.error?.status ?? 0) >= 500 || r.error?.kind === 'network'
})
```

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

**`logMiddleware`**

Logs request start and completion to the console with timing:

```
[liaise] → GET getItems /api/items
[liaise] ← getItems OK (142ms)

[liaise] → POST createUser /api/users
[liaise] ← createUser ERROR 422 (89ms)
```

Intended for development. In production, write a custom middleware that sends telemetry to your observability platform.

```ts
const api = createApi({
  baseUrl: '/api',
  requests: { getItems },
  middleware: [logMiddleware]
})
```

**`cacheMiddleware(options?)`**

Caches successful responses in memory, keyed by request name, method, the full URL, params and every request header except `Content-Type` (which is derived from the params). The URL's query string is part of the key with its pairs sorted by name, so `?a=1&b=2` and `?b=2&a=1` are one entry, while `?key=A` and `?key=B` (or a `?lang=de` appended by a middleware before the cache) are not. Calls that agree on all of those within the TTL window are served from cache without hitting the network. A different `Authorization` or any other header (except `Content-Type`), a different base URL, path or query value gets its own entry, so one user is never served another's response; the same query params in a different order share one. The query is sorted by raw (undecoded) name, keeping the order of repeated names. The trade-off: a middleware that adds a per-call unique header (a request ID, say) must come *after* `cacheMiddleware` in the middleware array; placed before it, every call carries a fresh header and nothing is ever cached. Each `cacheMiddleware()` call creates an isolated store — different endpoints never share entries.

Params are keyed by content, at every depth: plain data as sorted JSON with `undefined` members dropped (so `{ a: undefined }` and `{}` are one key), anything with `toJSON` by what it returns (a `Date` is its ISO string), and `Map`, `Set` and typed arrays by their entries. A call whose params cannot be keyed soundly — a BigInt, an `ArrayBuffer`, `Blob`, `FormData` or `URLSearchParams`, or an object with no enumerable state such as a class instance holding private fields — is never cached and never served from cache. The rule is the same one `share` uses; see [Sharing](#sharing).

```ts
const getUserCache = cacheMiddleware({ ttl: 5 * 60_000, maxSize: 100 })

const getUser = new Request<{ id: string }, User>({
  method: 'GET',
  path: '/users/:id',
  middleware: [getUserCache],
})

// On logout — clear all cached entries:
getUserCache.clear()

// Bypass cache for a single call:
const { data } = await api.getUser({ id: '42' }, { skipMiddleware: [getUserCache] })
```

Options: `ttl` (milliseconds, default 5 min), `maxSize` (max entries, default 50), `debug` (log hits/misses to console, default false). Only successful results are cached — errors always hit the network again.

### Sharing

Set `share: true` on a `Request` to coalesce identical concurrent calls onto a single in-flight request, instead of each caller firing its own:

```ts
const getProduct = new Request<{ id: string }, Product>({
  method: 'GET',
  path: '/products/:id',
  share: true
})

// Only one network request is made; both callers get the same response
const [a, b] = await Promise.all([
  api.getProduct({ id: '42' }),
  api.getProduct({ id: '42' })
])
```

`share` is the sibling of `dedupe`, with the opposite intent: **dedupe cancels** the older call in favor of the newer one, **share joins** the existing call instead of starting a new one. Because the two behaviors contradict each other, setting both on the same `Request` throws at `createApi(...)` time — not at call time — so the mistake surfaces immediately rather than the first time the endpoint is called.

**What counts as "identical":** the request name plus a content-based key of the params — object keys sorted, `undefined` members dropped (so `{ a: undefined }` and `{}` are one key), anything with `toJSON` keyed by what it returns (a `Date` is its ISO string), `Map`, `Set` and typed arrays keyed by their entries. Two calls with the same params to the same endpoint share; different params (or different endpoints) never do.

**What disables sharing for a single call:**

- A per-call `headers` or `middleware` — these change *what* is requested, so handing that caller another caller's response would be a real bug, not just a missed optimization. A call carrying either always gets its own, unshared request.
- Params that cannot be keyed soundly, at any depth: a BigInt, an `ArrayBuffer`, `Blob`, `FormData` or `URLSearchParams`, a circular structure, or an object with no enumerable state (a class instance keeping its state in private fields, an `Error`). Two different values of these kinds would otherwise risk one key, and one caller could receive the response meant for the other's payload. Declining to share is always safe; handing back the wrong response never is. A `Date`, `Map`, `Set` or typed array is keyed by its content and shares normally, and a raw `string` keys distinguishably, so a string-param endpoint is coalesced like any other.

**What does *not* disable sharing:** a per-call `signal` or `timeout`. These bound *who is still waiting*, not *what is being asked for*, so they're tracked with a per-caller refcount instead: each sharer's own signal/timeout only removes that caller from the wait list. The underlying request keeps running for everyone else, and is only aborted once every sharer — including the one that gave up — has stopped waiting. A sharer that gives up gets an error `Result` (`kind: 'timeout'` or `kind: 'abort'`), reported to `onError` exactly as the identical non-shared call would be — which means a `'timeout'` give-up reports and an `'abort'` give-up does not (see [Reporting errors with onError](#reporting-errors-with-onerror)).

**A per-*request* `timeout` is different: it belongs to the operation.** `RequestConfig.timeout` bounds the single shared request itself, measured from when that request started — not from when each caller joined it. Every sharer is therefore bounded by it, a late joiner cannot extend it, and a caller passing `timeout: 0` cannot switch it off for everyone else. Without that, a steadily arriving stream of joiners would keep one socket open indefinitely against a deadline that was supposed to cap it.

```ts
const impatient = api.getProduct({ id: '42' }, { timeout: 20 })   // gives up quickly
const patient = api.getProduct({ id: '42' })                      // keeps waiting

// impatient's early timeout does not cancel the shared request —
// patient still gets a real response.
```

**`result.retry()` on a shared result** re-runs the pipeline using the *acquiring caller's* own per-call options (headers, signal, timeout) — that is, whichever call first started the shared request, not whichever caller happens to invoke `retry()`. This falls out of every non-aborting sharer receiving the literal same `Result` object; it's unavoidable given that design, but worth knowing before relying on it.

**Signal-replacing middleware is safe under `share: true`.** A middleware that installs its own `ctx.request.signal` (a per-attempt timeout, say) does not detach the shared request from the refcount: the refcount signal is merged back in before `fetch`, so the request is still aborted once every sharer has given up.

## GraphQL Client

Use `createGraphQL` when your backend speaks GraphQL. **Everything in the REST API section applies here too** — `retryMiddleware`, `cacheMiddleware`, `logMiddleware`, `dedupe`, per-call `signal`, `onError`, `retry()`, `skipMiddleware`, header merging — all of it works identically for GraphQL operations. The only difference is transport: every operation is sent as an HTTP POST with `{ query, variables }`.

Both clients return the same `Result<T>` shape — `result.data`, `result.error`, `result.response`, and `result.retry` work identically.

```ts
import { createGraphQL, Operation, gql } from 'liaise'

interface Category {
  id: string
  name: string
  status: string
}

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

Operations with no variables can be called without arguments. Use `Record<string, never>` as `TVariables` to mark an operation as variable-free:

```ts
const getViewer = new Operation<Record<string, never>, ViewerData>({ operation: GET_VIEWER })
const graphql = createGraphQL({ endpoint, operations: { getViewer } })

const { data } = await graphql.getViewer() // params argument is optional
```

### Queries and mutations

When you want to distinguish queries from mutations in the client structure, use the `queries` and `mutations` keys instead of `operations`. The `operations` flat shape and the `queries`/`mutations` split are mutually exclusive — TypeScript enforces this at compile time.

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

### GraphQL errors

GraphQL errors (any 2xx with `{ errors: [...] }`) surface as `result.error` with the response's own `status` and `error.body` typed as `GraphQLError[]` — no special handling needed. The same `if (error) { ... }` check covers GraphQL errors, HTTP errors, and network errors uniformly.

GraphQL allows **partial success** -- a nullable field errors while the rest of the query resolves. That data is not discarded: it's available as `error.partialData`, never on `result.data` (which stays `null` whenever `error` is non-null, keeping `Result` a clean discriminated union):

```ts
const { error } = await graphql.getCategory({ id: '123' })
if (error) {
  console.log(error.body)          // GraphQLError[]
  console.log(error.partialData)   // whatever `data` the server sent alongside the errors, or undefined
}
```

GraphQL's own empty-success rule mirrors the REST client's: a 2xx response carrying neither `data` nor `errors` is `kind: 'parse'`, not a success with `data: null`. This covers an empty body, `{}`, a literal `{"data": null}`, and a non-object JSON root -- anything that reaches a 2xx without a `data` or `errors` key. `error.body` holds the raw response text, not a parsed value:

```ts
const { error } = await graphql.getCategory({ id: '123' })
if (error) {
  console.log(error.kind) // 'parse'
  console.log(error.body) // raw response text, e.g. '' or '{}'
}
```

A `{"data": null, "errors": [...]}` response is unchanged -- it's still `kind: 'http'`, with any partial result in `error.partialData`, since the GraphQL-errors branch runs first. See [MIGRATION.md](./MIGRATION.md#upgrading-to-400).

Operations support `dedupe: true` in the same way `Request` does — see [Drop stale calls with dedupe](#drop-stale-calls-with-dedupe).

### Middleware

`createGraphQL` accepts the same middleware options as `createApi` — global, per-operation, and per-call — and the `MiddlewareContext` shape is identical, so middleware written for `createApi` works here too.

```ts
const graphql = createGraphQL({
  endpoint: 'https://api.example.com/graphql',
  operations: { getCategory },
  middleware: [authMiddleware],
})
```

### API Reference additions

| Export              | Kind     | Description                                                            |
| ------------------- | -------- | ---------------------------------------------------------------------- |
| `createGraphQL`     | function | Creates a typed GraphQL client from a config of Operation definitions  |
| `Operation`         | class    | Typed operation definition -- one instance per GraphQL operation       |
| `gql`               | const    | Tagged template literal for GraphQL documents (editor tooling support) |
| `OperationConfig`   | type     | Config object for the `Operation` constructor                          |
| `GraphQLBaseConfig` | type     | Config object for `createGraphQL`                                      |
| `GraphQLError`      | type     | Shape of a single GraphQL error from `{ errors: [...] }`               |

## Testing

`liaise/testing` is a separate, framework-agnostic entry point for testing consumers of this library — it has no test-runner dependency, so it works the same under Vitest, Jest, or anything else. It gives you a `fetch` stub with route matching, so your tests exercise the real pipeline — URL building, path substitution, header merging, body serialization, response parsing, your own middleware — rather than stubbing an API method to return a canned `Result` and silently drifting out of sync with what the library actually does.

```ts
import { mockFetch, jsonResponse } from 'liaise/testing'

const mock = mockFetch({
  'GET /api/users/:id': ({ params }) => jsonResponse({ id: params.id, name: 'Ada' }),
  'POST /api/users': jsonResponse({ id: 'new-user' }, { status: 201 }),
})

mock.install()   // replaces globalThis.fetch
// ... exercise your code, which calls the real api.getUser(...) ...
mock.restore()    // puts the original globalThis.fetch back
```

Routes are keyed as `"METHOD /path"`, with `:token` segments captured and handed to a route function as `{ params, request }`. A route value can also be a plain `Response` (built with the `jsonResponse` helper, or your own), or an array of either — the array is consumed one response per matching call, and the final entry repeats once exhausted (handy for "fail twice, then succeed").

```ts
const mock = mockFetch({
  'GET /api/flaky': [jsonResponse(null, { status: 503 }), jsonResponse({ ok: true })],
})
```

`mock.calls` records every request (`{ method, url, headers, body }`); `mock.callCount('GET /api/users/:id')` and `mock.lastCall(...)` key off the same `"METHOD /path"` strings as the routes object.

An unmatched request makes the stub throw rather than invent a 404 — a mocked test should not quietly pass for a typo'd path. Note what your code actually sees, though: the library catches every `fetch` rejection by design, so that throw arrives as an ordinary `Result` with `error.kind === 'network'` and the `Error` itself as `error.body`, whose message names the method, the URL, and every route that was defined. Assert on the result (or read it in `onError`); do not expect the call to reject.

```ts
const r = await api.getUser({ id: '42' })   // routes only define 'GET /api/user/:id'
expect(r.error?.kind).toBe('network')
expect(String(r.error?.body)).toMatch(/no route matched GET \/api\/users\/42/)
```

An empty response array for a route behaves the same way — a descriptive `Error` reaching you as `error.body`, not a bare `TypeError`.

For stubbing at the `Result` level instead of the `fetch` level, `successResult(data)` and `errorResult(status, body)` build a well-formed `Result` directly (shown here with Vitest's `vi.spyOn`, but any runner's equivalent works the same way):

```ts
import { successResult, errorResult } from 'liaise/testing'

vi.spyOn(api, 'getUser').mockResolvedValue(successResult({ id: '42', name: 'Ada' }))
vi.spyOn(api, 'getUser').mockResolvedValue(errorResult(404, { message: 'not found' }))
```

A few behaviors worth knowing:

- **`mock.fetch` honours `init.signal`, like real `fetch`.** An already-aborted signal rejects with its `reason`, and so does one that aborts while a route handler is still pending — so a stalled route (`() => new Promise(() => {})`) lets you test your own `timeout` and cancellation handling through the stub. An aborted call is still recorded in `calls` and counted by `callCount`, but does not use up a response from a sequence.
- **`restore()` assumes `globalThis.fetch` was defined when `install()` ran** — true on Node 20+ (and in every browser), since `fetch` is a global there. If you somehow call `install()` in an environment where `globalThis.fetch` is `undefined` beforehand, `restore()` puts back that `undefined` rather than inventing a real `fetch`.
- **A route key must be `"METHOD /path"`.** A key with no space (`'/users'`) throws at `mockFetch(...)` time, naming the offending key, rather than silently registering a route that can never match.
- **Declaration order decides when two same-length routes could both match.** Routes are matched in the order they appear in the object you pass to `mockFetch`, and the first structural match wins — put more specific routes first if two patterns could both match the same path.
- **Trailing and duplicate slashes are normalized away on both sides.** `/a/b/`, `/a//b`, and `/a/b` all match the same route, whether the extra slash is in the route key or in the URL the library actually built.

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

### Per-attempt timeout

If you want a per-attempt budget instead — the axios-style behavior — write a small signal-replacing middleware and place it *inside* the retry middleware, so a fresh signal is installed on every attempt:

```ts
const perAttempt = (ms: number): Middleware => async (ctx, next) => {
  ctx.request.signal = AbortSignal.timeout(ms)
  return next()
}

const api = createApi({
  baseUrl: '/api',
  requests: { getUser },
  middleware: [retryMiddleware(3), perAttempt(5000)]
})
```

Because middleware order is outermost-to-innermost, `retryMiddleware(3)` re-invokes everything below it — including `perAttempt(5000)` — on every retry, so each attempt gets its own fresh 5-second budget instead of sharing one.
