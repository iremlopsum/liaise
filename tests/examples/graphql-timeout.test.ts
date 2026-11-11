import { it, expect, vi, afterAll, afterEach } from 'vitest'

// The example's deadlines are 45 seconds. Here every deadline fires 1000 times sooner;
// the spy records the value liaise asked for.
const realTimeout = AbortSignal.timeout.bind(AbortSignal)
const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => realTimeout(Math.ceil(ms / 1000)))
afterAll(() => timeoutSpy.mockRestore())
afterEach(() => { vi.unstubAllGlobals() })
// A server that never answers: each call ends only when its signal aborts.
vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
  init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
})))

// example:graphql-timeout:start
import { createGraphQL, Operation, gql } from 'liaise'

const team = new Operation<{ id: string }, { team: { id: string } }>({
  operation: gql`query Team($id: ID!) { team(id: $id) { id } }`,
})
// Reads a file and writes nothing, so a deadline is safe here too.
const previewUpload = new Operation<{ fileId: string }, { previewUpload: { rows: number } }>({
  operation: gql`mutation PreviewUpload($fileId: ID!) { previewUpload(fileId: $fileId) { rows } }`,
  timeout: 45_000,
})
// No deadline: abandoning it while the server may still commit it would
// invite a double write on "try again".
const commitUpload = new Operation<{ fileId: string }, { commitUpload: { ok: boolean } }>({
  operation: gql`mutation CommitUpload($fileId: ID!) { commitUpload(fileId: $fileId) { ok } }`,
})

const graphql = createGraphQL({
  endpoint: 'https://api.example.com/graphql',
  timeout: { queries: 45_000 }, // every query; mutations get none unless they set one
  queries: { team },
  mutations: { previewUpload, commitUpload },
})
// example:graphql-timeout:end

it('gives queries and the one opted-in mutation a 45 s deadline, and the other mutation none', async () => {
  const stop = new AbortController()
  const commit = graphql.mutation.commitUpload({ fileId: 'f1' }, { signal: stop.signal })
  const [q, p] = await Promise.all([graphql.query.team({ id: 't1' }), graphql.mutation.previewUpload({ fileId: 'f1' })])
  expect(q.error?.kind).toBe('timeout')
  expect(p.error?.kind).toBe('timeout')
  expect(timeoutSpy.mock.calls).toEqual([[45_000], [45_000]]) // commitUpload asked for none
  stop.abort()
  expect((await commit).error?.kind).toBe('abort')
})
