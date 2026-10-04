import { describe, it, expect } from 'vitest'
import { createApi, defineRequest, createGraphQL, Operation, gql } from '../src/index.js'

describe('getHeaders', () => {
  const api = createApi({
    baseUrl: 'https://x.test',
    headers: { 'X-Api-Version': '1', 'X-Client': 'web' },
    requests: {
      getUser: defineRequest<{ id: string }>()({ method: 'GET', path: '/users/:id', headers: { 'X-Api-Version': '2' } }),
      health: defineRequest<{ ok: boolean }>()({ method: 'GET', path: '/health' }),
    },
  })

  it('merges client and endpoint headers, endpoint winning, lowercase names', () => {
    expect(api.getUser.getHeaders()).toEqual({ 'x-api-version': '2', 'x-client': 'web' })
    expect(api.health.getHeaders()).toEqual({ 'x-api-version': '1', 'x-client': 'web' })
  })

  it('returns a fresh object each time; changing it changes nothing', () => {
    const h = api.getUser.getHeaders()
    h['x-client'] = 'hacked'
    expect(api.getUser.getHeaders()['x-client']).toBe('web')
  })

  it('works on GraphQL, flat and split', () => {
    const op = new Operation<Record<string, never>, { x: number }>({ operation: gql`query { x }`, headers: { 'X-Op': 'q' } })
    const flat = createGraphQL({ endpoint: 'https://x.test/graphql', headers: { Authorization: 'Bearer t' }, operations: { getX: op } })
    expect(flat.getX.getHeaders()).toEqual({ authorization: 'Bearer t', 'x-op': 'q' })
    const split = createGraphQL({ endpoint: 'https://x.test/graphql', queries: { getX: op } })
    expect(split.query.getX.getHeaders()).toEqual({ 'x-op': 'q' })
  })

  it('merges every HeadersInit shape: a Headers instance and tuple pairs', () => {
    const mixed = createApi({
      baseUrl: 'https://x.test',
      headers: new Headers({ 'X-Client': 'web', 'X-A': '0' }),
      requests: { get: defineRequest<{ ok: boolean }>()({ method: 'GET', path: '/x', headers: [['X-A', '1']] }) },
    })
    expect(mixed.get.getHeaders()).toEqual({ 'x-client': 'web', 'x-a': '1' })
  })

  it('joins a name repeated within one source as Headers does, and a later source replaces it', () => {
    const repeated = createApi({
      baseUrl: 'https://x.test',
      headers: [['X-Tag', 'a'], ['X-Tag', 'b']],
      requests: {
        get: defineRequest<{ ok: boolean }>()({ method: 'GET', path: '/x' }),
        over: defineRequest<{ ok: boolean }>()({ method: 'GET', path: '/y', headers: { 'X-Tag': 'c' } }),
      },
    })
    expect(repeated.get.getHeaders()).toEqual({ 'x-tag': 'a, b' })
    expect(repeated.over.getHeaders()).toEqual({ 'x-tag': 'c' })
  })
})
