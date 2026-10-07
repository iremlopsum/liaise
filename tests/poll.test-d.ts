import { describe, it, expectTypeOf } from 'vitest'
import { createApi, createGraphQL, defineRequest, Operation, gql, poll, pollUntil } from '../src/index.js'
import type { Pollable, Result, SuccessResult } from '../src/index.js'

type Job = { id: string; status: string }
const getJob = defineRequest<Job>()({ method: 'GET', path: '/jobs/:id' })
const api = createApi({ baseUrl: 'https://api.test', requests: { getJob } })

describe('poll types', () => {
  it('infers the callback Result and the until SuccessResult from the endpoint', () => {
    poll(api.getJob, { id: '1' }, r => { expectTypeOf(r).toEqualTypeOf<Result<Job>>() }, { every: 1000 })
    pollUntil(api.getJob, { id: '1' }, { every: 1000, until: r => { expectTypeOf(r).toEqualTypeOf<SuccessResult<Job>>(); return true } })
    expectTypeOf(pollUntil(api.getJob, { id: '1' }, { every: 1, until: () => true })).toEqualTypeOf<Promise<Result<Job>>>()
  })

  it('checks params against the endpoint', () => {
    // @ts-expect-error id is required
    poll(api.getJob, {}, () => {}, { every: 1000 })
    // @ts-expect-error id is required
    pollUntil(api.getJob, {}, { every: 1000, until: () => true })
  })

  it('accepts a GraphQL operation', () => {
    const getStats = new Operation<Record<string, never>, { stats: { n: number } }>({ operation: gql`query GetStats { stats { n } }` })
    const graph = createGraphQL({ endpoint: 'https://api.test/graphql', operations: { getStats } })
    expectTypeOf(graph.getStats).toMatchTypeOf<Pollable<Record<string, never>, { stats: { n: number } }>>()
  })
})
