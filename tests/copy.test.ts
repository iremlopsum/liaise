import { describe, it, expect } from 'vitest'
import {
  COPY, POLL_ID, originalState, nextCopy, pollKeyOf, stampCopier, copierOf, stampPollId, pollIdOf,
} from '../src/utils/copy.js'

const base = originalState({ 'X-Client': 'web' })

describe('copy state', () => {
  it('the original: one header source, no lane, dedupe on', () => {
    expect(base).toEqual({ headers: [{ 'X-Client': 'web' }], lane: '', dedupe: true })
  })

  it("a copy appends its headers after the parent's", () => {
    const copy = nextCopy(base, { cookie: 's=1' }, undefined)
    expect(copy.headers).toEqual([{ 'X-Client': 'web' }, { cookie: 's=1' }])
  })

  it('a copy that adds nothing keeps the empty lane', () => {
    expect(nextCopy(base, {}, undefined).lane).toBe('')
    expect(nextCopy(base, [], undefined).lane).toBe('')
  })

  it('the lane depends on the added headers only, not on name case, order or HeadersInit shape', () => {
    const a = nextCopy(base, { Cookie: 's=1', 'X-A': '1' }, undefined)
    const b = nextCopy(originalState(undefined), [['x-a', '1'], ['cookie', 's=1']], undefined)
    const c = nextCopy(base, new Headers({ 'x-a': '1', COOKIE: 's=1' }), undefined)
    expect(a.lane).not.toBe('')
    expect(a.lane.charCodeAt(0)).toBe(0) // starts with NUL: no endpoint lane starts that way
    expect(b.lane).toBe(a.lane)
    expect(c.lane).toBe(a.lane)
  })

  it('different values give different lanes', () => {
    expect(nextCopy(base, { cookie: 's=1' }, undefined).lane).not.toBe(nextCopy(base, { cookie: 's=2' }, undefined).lane)
  })

  it('a chained copy is laned by what all its layers add, later layers winning', () => {
    const chained = nextCopy(nextCopy(base, { x: '1', y: '1' }, undefined), { x: '2' }, undefined)
    expect(chained.headers).toEqual([{ 'X-Client': 'web' }, { x: '1', y: '1' }, { x: '2' }])
    expect(chained.lane).toBe(nextCopy(base, { x: '2', y: '1' }, undefined).lane)
  })

  it('invalid added headers never throw, and get a lane no other copy has', () => {
    const bad = { 'X-Bad': 'a\nb' }
    expect(() => nextCopy(base, bad, undefined)).not.toThrow()
    const one = nextCopy(base, bad, undefined)
    const two = nextCopy(base, bad, undefined)
    expect(one.lane).not.toBe('')
    expect(one.lane).not.toBe(two.lane)
  })

  it('dedupe: the option wins, otherwise the parent decides', () => {
    const off = nextCopy(base, {}, { dedupe: false })
    expect(off.dedupe).toBe(false)
    expect(nextCopy(off, {}, undefined).dedupe).toBe(false)
    expect(nextCopy(off, {}, {}).dedupe).toBe(false)
    expect(nextCopy(off, {}, { dedupe: true }).dedupe).toBe(true)
  })

  it('the poll key is the lane, marked when dedupe is off', () => {
    const on = nextCopy(base, { cookie: 's=1' }, undefined)
    const off = nextCopy(base, { cookie: 's=1' }, { dedupe: false })
    expect(pollKeyOf(base)).toBe('')
    expect(pollKeyOf(on)).toBe(on.lane)
    expect(pollKeyOf(off)).not.toBe(pollKeyOf(on))
    expect(pollKeyOf(nextCopy(base, {}, { dedupe: false }))).not.toBe('')
  })
})

describe('hidden stamps', () => {
  it('a copier is found on what carries one and nowhere else', () => {
    const client = { getUser: () => {} }
    const copier = () => ({})
    stampCopier(client, copier)
    expect(copierOf(client)).toBe(copier)
    for (const value of [null, undefined, 1, 'x', {}, () => {}, { [COPY]: 'not a function' }]) {
      expect(copierOf(value)).toBeUndefined()
    }
  })

  it('stamps are invisible to keys, spreads and JSON', () => {
    const client = { getUser: () => {} }
    stampCopier(client, () => ({}))
    stampPollId(client.getUser, client, 'k')
    expect(Object.keys(client)).toEqual(['getUser'])
    expect(copierOf({ ...client })).toBeUndefined()
    expect(JSON.stringify(client)).toBe('{}')
    expect(Object.getOwnPropertyDescriptor(client, COPY)?.enumerable).toBe(false)
    expect(Object.getOwnPropertyDescriptor(client.getUser, POLL_ID)?.enumerable).toBe(false)
  })

  it('a poll identity reads back as stamped', () => {
    const origin = () => {}
    const endpoint = () => {}
    expect(pollIdOf(endpoint)).toBeUndefined()
    stampPollId(endpoint, origin, 'k')
    expect(pollIdOf(endpoint)).toEqual({ origin, key: 'k' })
  })
})
