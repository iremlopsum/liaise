import { describe, it, expect, vi, afterEach } from 'vitest'
import { serializeBody } from '../src/utils/serialize.js'
import { createApi } from '../src/create-api.js'
import { Request } from '../src/request.js'
import { retryMiddleware } from '../src/built-in-middleware.js'

describe('serializeBody', () => {
  it('serializes plain objects as JSON', () => {
    const { body, contentType } = serializeBody({ name: 'test' })
    expect(body).toBe('{"name":"test"}')
    expect(contentType).toBe('application/json')
  })

  it('passes FormData as-is with no content type', () => {
    const formData = new FormData()
    formData.append('file', 'data')
    const { body, contentType } = serializeBody(formData)
    expect(body).toBe(formData)
    expect(contentType).toBeNull()
  })

  it('passes URLSearchParams as-is', () => {
    const params = new URLSearchParams({ a: '1' })
    const { body, contentType } = serializeBody(params)
    expect(body).toBe(params)
    expect(contentType).toBe('application/x-www-form-urlencoded')
  })

  it('passes Blob as-is', () => {
    const blob = new Blob(['data'])
    const { body, contentType } = serializeBody(blob)
    expect(body).toBe(blob)
    expect(contentType).toBe('application/octet-stream')
  })

  it('passes ArrayBuffer as-is', () => {
    const buffer = new ArrayBuffer(8)
    const { body, contentType } = serializeBody(buffer)
    expect(body).toBe(buffer)
    expect(contentType).toBe('application/octet-stream')
  })

  it('passes strings as-is', () => {
    const { body, contentType } = serializeBody('raw text')
    expect(body).toBe('raw text')
    expect(contentType).toBe('text/plain')
  })

  it('returns null body for null input', () => {
    const { body, contentType } = serializeBody(null)
    expect(body).toBeNull()
    expect(contentType).toBeNull()
  })

  it('returns null body for undefined input', () => {
    const { body, contentType } = serializeBody(undefined)
    expect(body).toBeNull()
    expect(contentType).toBeNull()
  })
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('serializeBody: binary views and streams', () => {
  it.each([
    ['Uint8Array', new Uint8Array([1, 2, 3])],
    ['Int16Array', new Int16Array([1, -1])],
    ['Float64Array', new Float64Array([1.5])],
    ['DataView', new DataView(new ArrayBuffer(4))],
    ['Buffer', Buffer.from([9, 8, 7])],
  ])('passes a %s through as binary', (_name, view) => {
    const { body, contentType } = serializeBody(view)
    expect(body).toBe(view)
    expect(contentType).toBe('application/octet-stream')
  })

  it('passes a ReadableStream through as binary', () => {
    const stream = new ReadableStream({ start(c) { c.close() } })
    const { body, contentType } = serializeBody(stream)
    expect(body).toBe(stream)
    expect(contentType).toBe('application/octet-stream')
  })
})

function okResponse(): Response {
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('binary and stream params reach fetch untouched', () => {
  it('sends a Uint8Array as the body, not a JSON index map', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', fetchMock)
    const upload = new Request<Uint8Array, unknown>({ method: 'POST', path: '/upload' })
    const api = createApi({ baseUrl: 'https://x.test', requests: { upload } })
    const bytes = new Uint8Array([1, 2, 3])

    const { error } = await api.upload(bytes)

    expect(error).toBeNull()
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.body).toBe(bytes)
    expect(new Headers(init.headers).get('content-type')).toBe('application/octet-stream')
  })

  it('sends a ReadableStream with duplex: half', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', fetchMock)
    const upload = new Request<ReadableStream, unknown>({ method: 'POST', path: '/upload' })
    const api = createApi({ baseUrl: 'https://x.test', requests: { upload } })
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.close() } })

    await api.upload(stream)

    const init = fetchMock.mock.calls[0][1] as RequestInit & { duplex?: string }
    expect(init.body).toBe(stream)
    expect(init.duplex).toBe('half')
  })

  it('refuses to resend a stream on retry instead of sending nothing', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const upload = new Request<ReadableStream, unknown>({ method: 'POST', path: '/upload' })
    const api = createApi({
      baseUrl: 'https://x.test',
      requests: { upload },
      middleware: [retryMiddleware({ max: 2, baseDelay: 0 })],
    })
    const stream = new ReadableStream({ start(c) { c.close() } })

    const { error } = await api.upload(stream)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(error?.kind).toBe('network')
    expect((error?.body as Error).message).toMatch(/can only be sent once/)
  })
})
