import { test } from 'node:test'
import assert from 'node:assert/strict'
import { observe } from './observe.mjs'

const result = (data, error = null) => ({ data, error, response: null, retry: () => {} })

test('classifies outcomes', async () => {
  assert.equal((await observe(async () => ({ ok: true }), { expected: { ok: true } })).outcome, 'data')
  assert.equal((await observe(async () => ({ message: 'boom' }), { expected: { ok: true } })).outcome, 'wrong data')
  assert.equal((await observe(async () => { const e = new Error('x'); e.name = 'HTTPError'; throw e }, {})).outcome, 'throws HTTPError')
  assert.equal((await observe(async () => result(null, { kind: 'http', status: 500 }), {})).outcome, 'error result (http)')
  assert.equal((await observe(async () => result({ ok: true }), { expected: { ok: true } })).outcome, 'data')
  assert.equal((await observe(() => new Promise(() => {}), { waitMs: 50 })).outcome, 'still waiting after 0.05s')
  assert.equal((await observe(async () => undefined, {})).outcome, 'resolves with undefined')
  assert.equal((await observe(async () => '', {})).outcome, 'resolves with ""')
  // A library error class whose instance carries a copied `name` (axios's AxiosError.from does this).
  class AxiosError extends Error {}
  assert.equal((await observe(async () => { const e = new AxiosError('x'); e.name = 'Error'; throw e }, {})).outcome, 'throws AxiosError (name: Error)')
  assert.equal((await observe(async () => { throw new DOMException('t', 'TimeoutError') }, {})).outcome, 'throws TimeoutError')
  assert.equal((await observe(async () => { throw new TypeError('t') }, {})).outcome, 'throws TypeError')
})
