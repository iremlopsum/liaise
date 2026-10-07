---
title: "Sending data"
order: 3
---
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

Which params go in the query string and which in the body is set per endpoint, under [Defining endpoints](/guide/defining-endpoints/).

## Query strings

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

## Request bodies

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

A `ReadableStream` body can be sent only once. A retry, from middleware or from `result.retry()`, returns an error telling you to read the stream into a `Blob` or `ArrayBuffer` first ([details](/reference/behaviour-in-detail/#stream-bodies)).

## What params can be

| You pass | What happens |
| -------- | ------------ |
| Plain object | Split into path params, query string and body |
| `Map` with string keys | Same as the object it spells |
| Class instance with fields | Same as a plain object (split by those fields even if the class also defines `toJSON()`; `toJSON()` is used only when there are no own fields) |
| Class instance with only `toJSON()` | Sent as its JSON (body only; refused on a request whose params go in the query string) |
| Typed array, `DataView`, `Buffer`, `ReadableStream` | Sent as the body, as in the table above (refused on a request whose params go in the query string) |
| `Set`, a bare `Date`, a `Map` with non-string keys, a class with no fields | Refused: an error `Result` (`kind: 'network'`) naming the type. Nothing is sent. |

A `Map`, `Set` or class with private state nested inside a JSON body is sent as `{}`, because that is what `JSON.stringify` does. Convert it first.

Headers, including your own `Content-Type`, follow the [three levels of settings](/start/how-it-fits-together/#three-levels-of-settings).
