import { describe, it, expect, afterEach } from 'vitest'
import { createGraphQL, Operation, gql, withHeaders } from '../src/index.js'
import { mockFetch, jsonResponse } from '../src/testing.js'

type Who = { who: string | null }
let mock: ReturnType<typeof mockFetch>
afterEach(() => mock?.restore())

function serve(ms = 0) {
  mock = mockFetch({
    'POST /graphql': async ({ request }) => {
      if (ms) await new Promise(r => setTimeout(r, ms))
      return jsonResponse({ data: { who: request.headers.get('cookie') } })
    },
  })
  mock.install()
}

const endpoint = 'https://api.test/graphql'
const op = (extra: { dedupe?: boolean; share?: boolean } = {}) =>
  new Operation<Record<string, never>, Who>({ operation: gql`query Who { who }`, ...extra })
const cookie = (i: number) => mock.calls[i].headers.get('cookie')

describe('withHeaders: GraphQL', () => {
  it("flat: the copy sends its headers, the original doesn't, getHeaders shows them", async () => {
    serve()
    const graph = createGraphQL({ endpoint, headers: { 'X-Client': 'web' }, operations: { who: op() } })
    const copy = withHeaders(graph, { cookie: 's=alice' })
    expect((await copy.who()).data?.who).toBe('s=alice')
    expect((await graph.who()).data?.who).toBeNull()
    expect(copy.who.getHeaders()).toEqual({ cookie: 's=alice', 'x-client': 'web' })
  })

  it('split: a copy of the root has both sides, each sending the headers', async () => {
    serve()
    const graph = createGraphQL({ endpoint, queries: { who: op() }, mutations: { touch: op() } })
    const copy = withHeaders(graph, { cookie: 's=alice' })
    await copy.query.who()
    await copy.mutation.touch()
    expect([cookie(0), cookie(1)]).toEqual(['s=alice', 's=alice'])
  })

  it('split: a copy of one side is that side only', async () => {
    serve()
    const graph = createGraphQL({ endpoint, queries: { who: op() }, mutations: { touch: op() } })
    const side = withHeaders(graph.query, { cookie: 's=bob' })
    expect(Object.keys(side)).toEqual(['who'])
    expect((await side.who()).data?.who).toBe('s=bob')
  })

  it('mutating the headers object after the copy is made changes nothing it sends', async () => {
    serve()
    const graph = createGraphQL({ endpoint, queries: { who: op() } })
    const headers = { cookie: 's=alice' }
    const copy = withHeaders(graph, headers)
    headers.cookie = 's=bob'
    expect((await copy.query.who()).data?.who).toBe('s=alice')
    expect(copy.query.who.getHeaders()).toEqual({ cookie: 's=alice' })
  })

  it('a chained side copy sends every layer', async () => {
    serve()
    const graph = createGraphQL({ endpoint, queries: { who: op() } })
    const copy = withHeaders(withHeaders(graph, { cookie: 's=alice' }).query, { 'X-More': '1' })
    await copy.who()
    expect(cookie(0)).toBe('s=alice')
    expect(mock.calls[0].headers.get('x-more')).toBe('1')
  })

  it("dedupe: same added headers share a lane; different ones don't", async () => {
    serve(20)
    const graph = createGraphQL({ endpoint, queries: { who: op({ dedupe: true }) } })
    const first = withHeaders(graph, { cookie: 's=alice' }).query.who()
    const second = withHeaders(graph, { cookie: 's=alice' }).query.who()
    const bob = withHeaders(graph, { cookie: 's=bob' }).query.who()
    expect((await first).error?.kind).toBe('abort')
    expect((await second).data?.who).toBe('s=alice')
    expect((await bob).data?.who).toBe('s=bob')
  })

  it('dedupe: { dedupe: false } turns it off for the copy', async () => {
    serve(20)
    const graph = createGraphQL({ endpoint, operations: { who: op({ dedupe: true }) } })
    const off = withHeaders(graph, { cookie: 's=alice' }, { dedupe: false })
    const a = off.who()
    const b = off.who()
    expect((await a).error).toBeNull()
    expect((await b).error).toBeNull()
  })

  it('share: two copies for one user share one request; another user never joins', async () => {
    serve(20)
    const graph = createGraphQL({ endpoint, operations: { who: op({ share: true }) } })
    const [a1, a2, b] = await Promise.all([
      withHeaders(graph, { cookie: 's=alice' }).who(),
      withHeaders(graph, { cookie: 's=alice' }).who(),
      withHeaders(graph, { cookie: 's=bob' }).who(),
    ])
    expect(mock.callCount('POST /graphql')).toBe(2)
    expect([a1.data?.who, a2.data?.who, b.data?.who]).toEqual(['s=alice', 's=alice', 's=bob'])
  })

  it('split: operations added to the passed record after construction are not in a copy', () => {
    serve()
    const queries: Record<string, Operation<any, any>> = { who: op() }
    const graph = createGraphQL({ endpoint, queries, mutations: { touch: op() } })
    queries.late = op()
    expect(Object.keys(withHeaders(graph, {}).query)).toEqual(Object.keys(graph.query))
    expect(Object.keys(withHeaders(graph.query, {}))).toEqual(Object.keys(graph.query))
  })

  it('split: a query and a mutation of one name keep separate dedupe lanes on a copy', async () => {
    serve(20)
    const graph = createGraphQL({ endpoint, queries: { user: op({ dedupe: true }) }, mutations: { user: op({ dedupe: true }) } })
    const copy = withHeaders(graph, { cookie: 's=a' })
    const m = copy.mutation.user()
    const q = copy.query.user()
    expect((await m).error).toBeNull()
    expect((await q).error).toBeNull()
  })

  it('getHeaders on a chained copy and on a side copy merges every layer', () => {
    serve()
    const graph = createGraphQL({ endpoint, queries: { who: op() } })
    const chained = withHeaders(withHeaders(graph, { 'X-A': '1', 'X-B': '1' }).query, { 'X-B': '2' })
    expect(chained.who.getHeaders()).toMatchObject({ 'x-a': '1', 'x-b': '2' })
  })

  it("GraphQL: an invalid header value is a 'network' Result and getHeaders() is {}", async () => {
    serve()
    const graph = createGraphQL({ endpoint, operations: { who: op() } })
    const copy = withHeaders(graph, { 'X Bad': '1' })
    expect((await copy.who()).error?.kind).toBe('network')
    expect(copy.who.getHeaders()).toEqual({})
    expect(mock.calls).toHaveLength(0)
  })
})
