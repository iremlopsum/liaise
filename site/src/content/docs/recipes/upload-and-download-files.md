---
title: "Upload and download files"
order: 10
---
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

Call it with `api.uploadAvatar(form)` and `api.downloadFile({ id })`. Other body types (a `Blob`, a `ReadableStream`) are listed under [Sending data](/guide/sending-data/).
