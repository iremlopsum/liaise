import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendExchange, AbortedRead } from '../src/utils/exchange.js'
import type { Exchange } from '../src/utils/exchange.js'

afterEach(() => vi.unstubAllGlobals())

const stub = (r: Response | (() => Promise<Response>)) =>
  vi.stubGlobal('fetch', vi.fn(async () => (typeof r === 'function' ? r() : r)))

describe('sendExchange', () => {
  it('reads a json/text body once, as text', async () => {
    stub(new Response('{"a":1}', { status: 200 }))
    const ex = await sendExchange('https://x.test/a', {}, 'json')
    expect(ex.body).toBe('{"a":1}')
    expect(ex.readFailed).toBe(false)
    expect(ex.response.bodyUsed).toBe(true)
  })

  it('reads blob, arrayBuffer and formData natively', async () => {
    stub(new Response(new Blob(['hi'])))
    expect((await sendExchange('https://x.test', {}, 'blob')).body).toBeInstanceOf(Blob)
    stub(new Response(new Uint8Array([1, 2])))
    expect((await sendExchange('https://x.test', {}, 'arrayBuffer')).body).toBeInstanceOf(ArrayBuffer)
    stub(new Response(new URLSearchParams('a=1')))
    expect((await sendExchange('https://x.test', {}, 'formData')).body).toBeInstanceOf(FormData)
  })

  it("cancels the body for 'none' on a 2xx and reads it as text on a non-2xx", async () => {
    stub(new Response('ignored', { status: 200 }))
    expect((await sendExchange('https://x.test', {}, 'none')).body).toBeUndefined()
    stub(new Response('{"error":"gone"}', { status: 409 }))
    expect((await sendExchange('https://x.test', {}, 'none')).body).toBe('{"error":"gone"}')
  })

  it('records a read failure that the signal did not cause', async () => {
    const broken = new Response(new ReadableStream({ start(c) { c.error(new TypeError('stream broke')) } }))
    stub(broken)
    // A live, never-aborted signal: having a signal at all must not turn a
    // read failure into an AbortedRead — only an aborted one does. Caught
    // rather than awaited bare, so that regression fails as an assertion.
    const outcome: unknown = await sendExchange('https://x.test', { signal: new AbortController().signal }, 'json')
      .catch((e: unknown) => e)
    expect(outcome).not.toBeInstanceOf(AbortedRead)
    const ex = outcome as Exchange
    expect(ex.readFailed).toBe(true)
    expect(String(ex.readError)).toContain('stream broke')
  })

  it('throws AbortedRead when the request signal aborted during the read', async () => {
    const ac = new AbortController()
    const body = new ReadableStream({ start(c) { ac.signal.addEventListener('abort', () => c.error(new Error('cut'))) } })
    stub(new Response(body))
    const pending = sendExchange('https://x.test', { signal: ac.signal }, 'text')
    await new Promise(r => setTimeout(r, 0))
    ac.abort(new DOMException('gone', 'AbortError'))
    const err = await pending.catch(e => e)
    expect(err).toBeInstanceOf(AbortedRead)
    expect((err as AbortedRead).reason).toBe(ac.signal.reason)
    expect(String((err as AbortedRead).cause)).toContain('cut')
  })
})
