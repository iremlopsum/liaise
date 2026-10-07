import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApi, Request } from '../src/index.js'
import { mockFetch, jsonResponse } from '../src/testing.js'

// Under responseType 'none' the unread body is cancelled. On a cloned Response, cancel() does
// not settle while the other branch of the tee is unread, so awaiting it hung the call for good
// (5.1.1). mockFetch serves a static route as a clone, and so can any fetch wrapper.
const settles = (p: Promise<unknown>, ms = 500) =>
  Promise.race([p.then(() => 'settled'), new Promise(r => setTimeout(() => r('still pending'), ms))])

const ping = new Request({ method: 'POST', path: '/ping', responseType: 'none' })
const client = () => createApi({ baseUrl: 'https://api.test', requests: { ping } })

describe("responseType 'none' on a cloned Response", () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('settles when fetch returns a clone whose original is never read', async () => {
    const original = new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    vi.stubGlobal('fetch', async () => original.clone())
    const call = client().ping()
    expect(await settles(call)).toBe('settled')
    expect(await call).toMatchObject({ data: undefined, error: null })
  })

  it('settles against a static mockFetch route', async () => {
    const mock = mockFetch({ 'POST /ping': jsonResponse({ ok: true }) })
    mock.install()
    try {
      const call = client().ping()
      expect(await settles(call)).toBe('settled')
      expect(await call).toMatchObject({ data: undefined, error: null })
    } finally {
      mock.restore()
    }
  })

  it('still cancels the unread body', async () => {
    let cancelled = false
    const body = new ReadableStream({ cancel() { cancelled = true } })
    vi.stubGlobal('fetch', async () => new Response(body, { status: 200 }))
    await client().ping()
    await new Promise(r => setTimeout(r, 0))
    expect(cancelled).toBe(true)
  })
})
