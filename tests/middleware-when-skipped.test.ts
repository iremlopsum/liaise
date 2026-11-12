// A skipped middleware can leave a stand-in in its place (5.5.0): composeMiddleware
// replaces a middleware found in `skip` with the function it carries under
// Symbol.for('liaise.whenSkipped'). cacheMiddleware uses it so that skipping the cache
// still stores the fresh answer.
import { describe, it, expect } from 'vitest'
import { composeMiddleware, WHEN_SKIPPED } from '../src/middleware.js'
import { successResult } from '../src/testing.js'
import type { Middleware, MiddlewareContext } from '../src/types.js'

const ctx = () => ({ request: { method: 'GET', url: '/', headers: new Headers(), params: {} }, requestName: 'x' }) as unknown as MiddlewareContext

function setup() {
  const order: string[] = []
  const core = async () => { order.push('core'); return successResult(null) }
  const named = (name: string): Middleware => async (_c, next) => { order.push(name); return next() }
  return { order, core, a: named('a'), b: named('b'), c: named('c'), named }
}

describe('composeMiddleware: a skipped middleware’s stand-in', () => {
  it('replaces a skipped middleware with its stand-in, in the same position', async () => {
    const { order, core, a, b, c, named } = setup()
    Object.defineProperty(b, WHEN_SKIPPED, { value: named('b*') })
    await composeMiddleware([a, b, c], core, [b])(ctx())
    expect(order).toEqual(['a', 'b*', 'c', 'core'])
  })

  it('runs the middleware itself when it is not skipped', async () => {
    const { order, core, a, b, c, named } = setup()
    Object.defineProperty(b, WHEN_SKIPPED, { value: named('b*') })
    await composeMiddleware([a, b, c], core, [])(ctx())
    expect(order).toEqual(['a', 'b', 'c', 'core'])
  })

  it('removes a skipped middleware without a stand-in', async () => {
    const { order, core, a, b, c } = setup()
    await composeMiddleware([a, b, c], core, [b])(ctx())
    expect(order).toEqual(['a', 'c', 'core'])
  })

  it('removes a skipped middleware whose stand-in is not a function', async () => {
    const { order, core, a, b, c } = setup()
    Object.defineProperty(b, WHEN_SKIPPED, { value: 42 })
    await composeMiddleware([a, b, c], core, [b])(ctx())
    expect(order).toEqual(['a', 'c', 'core'])
  })

  it('WHEN_SKIPPED is the registered symbol', () => {
    expect(WHEN_SKIPPED).toBe(Symbol.for('liaise.whenSkipped'))
  })
})
