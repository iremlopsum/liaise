import { it, expect, afterEach } from 'vitest'
import { mockFetch, jsonResponse } from 'liaise/testing'

let mock: ReturnType<typeof mockFetch>
afterEach(() => mock.restore())

// example:files:start
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
// example:files:end

it('uploads FormData as multipart', async () => {
  let received: FormData | undefined
  let contentType: string | null = null
  mock = mockFetch({
    'POST /api/avatar': async ({ request }) => {
      contentType = request.headers.get('content-type')
      received = await request.formData()
      return jsonResponse({ url: '/a.png' })
    },
  })
  mock.install()
  const form = new FormData()
  form.append('file', new Blob(['png-bytes']), 'a.png')
  const r = await api.uploadAvatar(form)
  expect(r.data).toEqual({ url: '/a.png' })
  expect(contentType).toMatch(/^multipart\/form-data; boundary=/)
  expect(received?.get('file')).toBeInstanceOf(Blob)
})

it('downloads a Blob', async () => {
  mock = mockFetch({ 'GET /api/files/:id': new Response(new Blob(['hello']), { status: 200 }) })
  mock.install()
  const r = await api.downloadFile({ id: '9' })
  expect(r.data).toBeInstanceOf(Blob)
  expect(await r.data!.text()).toBe('hello')
})
