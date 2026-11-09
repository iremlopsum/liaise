import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createApi } from '../../src/create-api.js'
import { Request } from '../../src/request.js'
import { createGraphQL, Operation, gql } from '../../src/graphql.js'
import { createPager } from '../../src/pager.js'
import { startServer, type TestServer } from './server.js'

interface Numbered { items: number[]; totalCount: number }
interface NumberedParams { offset?: number; limit?: number; delay?: number }

let server: TestServer

beforeAll(async () => { server = await startServer() })
afterAll(async () => { await server.close() })
afterEach(() => { server.callCounts.clear(); server.queryCounts.clear() })

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

/** How many requests the server saw for `offset`, whatever else the query carried. */
function requestsFor(offset: number): number {
  let total = 0
  for (const [key, count] of server.queryCounts) {
    if (!key.startsWith('GET /numbered?')) continue
    if (new URL(key.slice(4), 'http://x').searchParams.get('offset') === String(offset)) total += count
  }
  return total
}

describe('createPager over real HTTP', () => {
  const LIMIT = 10
  // Page n starts at offset (n - 1) * LIMIT; `delays` makes a page reply late.
  const numberedBy = (delays: Record<number, number> = {}) =>
    (page: number, params: NumberedParams): NumberedParams =>
      ({ ...params, offset: (page - 1) * LIMIT, delay: delays[page] ?? 0 })
  const pageCount = (r: { data: Numbered }) => Math.ceil(r.data.totalCount / LIMIT)

  it('3 → 5 → 4 over real fetch: the final state is page 4 and the aborted replies never land', async () => {
    const api = createApi({
      baseUrl: server.baseUrl,
      requests: { numbered: new Request<NumberedParams, Numbered>({ method: 'GET', path: '/numbered' }) },
    })
    const pager = createPager(api.numbered, { limit: LIMIT }, {
      toParams: numberedBy({ 3: 200, 5: 100, 4: 0 }),
      pageCount,
    })
    const seen: Array<number | null> = []
    const errors: Array<string | undefined> = []
    pager.subscribe(() => {
      seen.push(pager.state.page)
      errors.push(pager.state.error?.kind)
    })

    await pager.load()
    expect(pager.state.page).toBe(1)

    const three = pager.goTo(3)
    await wait(40)
    const five = pager.goTo(5)
    await wait(40)
    const four = pager.goTo(4)

    const [r3, r5, r4] = await Promise.all([three, five, four])
    // Outwait the superseded replies: page 3 would answer at 200 ms, page 5 at 100 ms.
    await wait(250)

    expect(r3?.error?.kind).toBe('abort')
    expect(r5?.error?.kind).toBe('abort')
    expect(r4?.error).toBeNull()
    expect(pager.state.page).toBe(4)
    expect(pager.state.loading).toBe(false)
    expect(pager.state.data?.items[0]).toBe(30)
    // 1 and 4 landed; 3 and 5 never did, even though the server was asked.
    expect(seen).not.toContain(3)
    expect(seen).not.toContain(5)
    // And not even as an error: a superseded move leaves no trace in the state.
    expect(errors.filter(Boolean)).toEqual([])
    expect(requestsFor(0)).toBe(1)
    expect(requestsFor(20)).toBe(1)
    expect(requestsFor(40)).toBe(1)
    expect(requestsFor(30)).toBe(1)
  })

  it("a share endpoint: a superseded pager move doesn't cancel another caller joined to the same request", async () => {
    const api = createApi({
      baseUrl: server.baseUrl,
      requests: {
        numbered: new Request<NumberedParams, Numbered>({ method: 'GET', path: '/numbered', share: true }),
      },
    })
    const toParams = numberedBy({ 1: 150 })
    const pager = createPager(api.numbered, { limit: LIMIT }, { toParams, pageCount })

    // The plain call and the pager's load() send the same params, so they join.
    const plain = api.numbered(toParams(1, { limit: LIMIT }))
    const load = pager.load()
    await wait(30)
    const two = pager.goTo(2)

    const [plainResult, loadResult, twoResult] = await Promise.all([plain, load, two])

    expect(plainResult.error).toBeNull()
    expect(plainResult.data?.items).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(loadResult?.error?.kind).toBe('abort')
    expect(twoResult?.error).toBeNull()
    expect(pager.state.page).toBe(2)
    expect(pager.state.data?.items[0]).toBe(10)
    // One network request for page 1, shared by the plain call and the pager.
    expect(requestsFor(0)).toBe(1)
    expect(requestsFor(10)).toBe(1)
  })

  it('a createGraphQL operation works as the endpoint', async () => {
    interface Vars { offset?: number; limit?: number }
    interface Data { numbered: Numbered }
    const client = createGraphQL({
      endpoint: `${server.baseUrl}/graphql`,
      operations: {
        numbered: new Operation<Vars, Data>({
          operation: gql`query gqlNumbered($offset: Int, $limit: Int) { gqlNumbered(offset: $offset, limit: $limit) { items totalCount } }`,
        }),
      },
    })
    const pager = createPager(client.numbered, { limit: LIMIT }, {
      toParams: (page, vars: Vars): Vars => ({ ...vars, offset: (page - 1) * LIMIT }),
      pageCount: r => Math.ceil(r.data.numbered.totalCount / LIMIT),
    })

    const first = await pager.load()
    expect(first?.error).toBeNull()
    expect(pager.state.page).toBe(1)
    expect(pager.state.pageCount).toBe(23)
    expect(pager.state.data?.numbered.items).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])

    await pager.goTo(23)
    expect(pager.state.page).toBe(23)
    expect(pager.state.hasNext).toBe(false)
    expect(pager.state.data?.numbered.items).toEqual([220, 221, 222, 223, 224, 225, 226, 227, 228, 229])
    expect(server.callCounts.get('POST /graphql')).toBe(2)

    // Back to page 1 comes from the cache: no third request.
    await pager.goTo(1)
    expect(pager.state.page).toBe(1)
    expect(server.callCounts.get('POST /graphql')).toBe(2)
  })
})
