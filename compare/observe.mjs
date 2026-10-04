import { isDeepStrictEqual } from 'node:util'

const isResult = v => v !== null && typeof v === 'object' && 'data' in v && 'error' in v && 'retry' in v

function describe(value, expected) {
  if (isResult(value)) {
    return value.error ? `error result (${value.error.kind})` : describe(value.data, expected)
  }
  if (expected === undefined) return `resolves with ${value === undefined ? 'undefined' : JSON.stringify(value)}`
  return isDeepStrictEqual(value, expected) ? 'data' : 'wrong data'
}

/** What your code receives from fn(), in one fixed vocabulary, and how long it took. */
export async function observe(fn, { expected, waitMs = 10_000 } = {}) {
  const started = performance.now()
  let timer
  const waiting = new Promise(resolve => {
    timer = setTimeout(() => resolve(`still waiting after ${waitMs / 1000}s`), waitMs)
  })
  const settled = Promise.resolve()
    .then(fn)
    .then(v => describe(v, expected), e => `throws ${e?.name ?? typeof e}`)
  const outcome = await Promise.race([settled, waiting])
  clearTimeout(timer)
  return { outcome, ms: Math.round(performance.now() - started) }
}
