import { describe, it, expect, vi, afterEach } from 'vitest'
import { runInNewContext } from 'node:vm'
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
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1] as RequestInit
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

    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1] as RequestInit & { duplex?: string }
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

class WithFields { constructor(public name = 'x') {} }
class OnlyToJSON { #n = 3; toJSON() { return { n: this.#n } } }
class OnlyGetters { #n = 3; get n() { return this.#n } }

async function send(method: 'GET' | 'POST', path: string, params: unknown) {
  const fetchMock = vi.fn(async () => okResponse())
  vi.stubGlobal('fetch', fetchMock)
  const call = new Request<any, unknown>({ method, path })
  const api = createApi({ baseUrl: 'https://x.test', requests: { call } })
  const result = await api.call(params)
  const [url, init] = (fetchMock.mock.calls[0] ?? []) as [string?, RequestInit?]
  return { result, url, init, fetchMock }
}

describe('params that used to send nothing', () => {
  it('a string-keyed Map is the object it spells, as body', async () => {
    const { init } = await send('POST', '/items', new Map([['name', 'x']]))
    expect(init?.body).toBe('{"name":"x"}')
  })

  it('a string-keyed Map fills path tokens and the query string on GET', async () => {
    const { url } = await send('GET', '/users/:id', new Map([['id', '7'], ['q', 'x']]))
    expect(url).toBe('https://x.test/users/7?q=x')
  })

  it('a class with only toJSON is sent as its JSON', async () => {
    const { init } = await send('POST', '/items', new OnlyToJSON())
    expect(init?.body).toBe('{"n":3}')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
  })

  it('a class with public fields keeps decomposing like an object', async () => {
    const { init } = await send('POST', '/items', new WithFields())
    expect(init?.body).toBe('{"name":"x"}')
  })

  it.each([
    ['a Set', new Set([1]), /Set/],
    ['a Date', new Date(0), /Date/],
    ['a Map with non-string keys', new Map([[1, 'a']]), /non-string keys/],
    ['a class with only getters', new OnlyGetters(), /OnlyGetters/],
  ])('refuses %s with an error Result naming the type, and sends nothing', async (_n, params, message) => {
    const { result, fetchMock } = await send('POST', '/items', params)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.error?.kind).toBe('network')
    expect((result.error?.body as Error).message).toMatch(message)
  })

  it.each([
    ['a Uint8Array', new Uint8Array([1])],
    ['a ReadableStream', new ReadableStream()],
    ['a DataView', new DataView(new ArrayBuffer(2))],
    ['a Buffer', Buffer.from([1, 2])],
    ['a class with only toJSON', new OnlyToJSON()],
  ])('refuses %s on a GET instead of dropping it', async (_n, params) => {
    const { result, fetchMock } = await send('GET', '/items', params)
    expect(fetchMock).not.toHaveBeenCalled()
    expect((result.error?.body as Error).message).toMatch(/query string/)
  })

  it('refuses a Map with non-string keys on a GET', async () => {
    const { result, fetchMock } = await send('GET', '/items', new Map([[1, 'a']]))
    expect(fetchMock).not.toHaveBeenCalled()
    expect((result.error?.body as Error).message).toMatch(/non-string keys/)
  })

  it('treats a plain object from another realm as fields, not as a class', async () => {
    const foreign = runInNewContext('({ a: 1 })') as Record<string, unknown>
    const { init } = await send('POST', '/items', foreign)
    expect(init?.body).toBe('{"a":1}')
    const empty = await send('POST', '/items', runInNewContext('({})'))
    expect(empty.result.error).toBeNull()
  })

  it('uses "an" before a vowel and "a" before a consonant in refusal messages', async () => {
    const view = await send('GET', '/items', new Int16Array([1]))
    expect((view.result.error?.body as Error).message).toMatch(/Cannot send an Int16Array/)
    const u8 = await send('GET', '/items', new Uint8Array([1]))
    expect((u8.result.error?.body as Error).message).toMatch(/Cannot send a Uint8Array/)
    const set = await send('POST', '/items', new Set([1]))
    expect((set.result.error?.body as Error).message).toMatch(/Cannot send a Set/)
    class Money { #c = 1; get c() { return this.#c } }
    const m = await send('POST', '/items', new Money())
    expect((m.result.error?.body as Error).message).toMatch(/a Money/)
    const o = await send('POST', '/items', Object.create({ inherited: 1 }, {}) as object)
    expect((o.result.error?.body as Error).message).toMatch(/an Object/)
  })
})
