---
title: "Reading responses"
order: 4
---
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
- **Declare `'none'` with the response type `undefined`.** `defineRequest` enforces this ([Defining endpoints](/guide/defining-endpoints/)). [Without defineRequest](/guide/defining-endpoints/#without-definerequest) it is only a convention, and `data` is `undefined` at runtime whatever type you wrote.
- **A non-2xx body is still read into `error.body`**, because an error body usually explains what went wrong. Under `'none'` it is read as JSON, and `error.body` is `null` when it isn't JSON:

  ```ts
  const { error } = await api.deleteUser({ id: '42' })
  if (error) {
    // A 409 { "error": "already deleted" } lands in error.body,
    // even though deleteUser declares responseType: 'none'.
    console.error(error.status, error.body)
  }
  ```
