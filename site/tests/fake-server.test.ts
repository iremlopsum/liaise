import { describe, it, expect, vi, afterEach } from 'vitest'
import { createFakeServer, FAKE_ORIGIN, SLOW_MS, ITEMS, SLOW_ITEMS_MS, type UnreadMode } from '../src/playground/fake-server'

const UNREAD = `${FAKE_ORIGIN}/notifications/unread`
afterEach(() => { vi.useRealTimers() })

describe('fake server: GET /notifications/unread (the intro challenge)', () => {
  it('answers { unread: 3 } when no switch is given', async () => {
    const res = await createFakeServer().fetch(UNREAD)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ unread: 3 })
  })
  it('answers 500 while the switch says down, reading the switch on every request', async () => {
    let mode: UnreadMode = 'down'
    const server = createFakeServer({ unread: () => mode })
    const down = await server.fetch(UNREAD)
    expect(down.status).toBe(500)
    expect(await down.json()).toEqual({ message: 'Server error' })
    mode = 'healthy'
    expect((await server.fetch(UNREAD)).status).toBe(200)
  })
  it('takes SLOW_MS to answer while slow', async () => {
    vi.useFakeTimers()
    const server = createFakeServer({ unread: () => 'slow' })
    let answered = false
    const res = server.fetch(UNREAD).then((r) => { answered = true; return r })
    await vi.advanceTimersByTimeAsync(SLOW_MS - 1)
    expect(answered).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect((await res).status).toBe(200)
  })
  it('reports the request and how it settled, like every other route', async () => {
    const sent: unknown[] = [], settled: unknown[] = []
    await createFakeServer({ onRequest: (r) => sent.push(r), onSettle: (s) => settled.push(s) }).fetch(UNREAD)
    expect(sent).toEqual([expect.objectContaining({ method: 'GET', path: '/notifications/unread' })])
    expect(settled).toEqual([expect.objectContaining({ outcome: 200 })])
  })
})

describe('fake server: GET /items (the pager example)', () => {
  it('pages through 230 items by offset and limit', async () => {
    const server = createFakeServer()
    const first = await (await server.fetch(`${FAKE_ORIGIN}/items?offset=0&limit=25`)).json()
    expect(first.total).toBe(ITEMS)
    expect(ITEMS).toBe(230)
    expect(first.items).toHaveLength(25)
    expect(first.items[0]).toEqual({ id: 1, name: 'Item 1' })
    const last = await (await server.fetch(`${FAKE_ORIGIN}/items?offset=225&limit=25`)).json()
    expect(last.items.map((i: { id: number }) => i.id)).toEqual([226, 227, 228, 229, 230])
  })
  it('answers offset 50 after SLOW_ITEMS_MS, and the others sooner', async () => {
    vi.useFakeTimers()
    const server = createFakeServer()
    let slow = false, quick = false
    void server.fetch(`${FAKE_ORIGIN}/items?offset=50&limit=25`).then(() => { slow = true })
    void server.fetch(`${FAKE_ORIGIN}/items?offset=100&limit=25`).then(() => { quick = true })
    await vi.advanceTimersByTimeAsync(SLOW_ITEMS_MS - 1)
    expect(quick).toBe(true)
    expect(slow).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(slow).toBe(true)
  })
})
