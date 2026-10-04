import { isDeepStrictEqual } from 'node:util'

const isResult = v => v !== null && typeof v === 'object' && 'data' in v && 'error' in v && 'retry' in v

function describe(value, expected) {
  if (isResult(value)) {
    return value.error ? `error result (${value.error.kind})` : describe(value.data, expected)
  }
  if (expected === undefined) return `resolves with ${value === undefined ? 'undefined' : JSON.stringify(value)}`
  return isDeepStrictEqual(value, expected) ? 'data' : 'wrong data'
}

/**
 * How a thrown value is named. Some libraries copy the cause's `name` onto their own error
 * class (axios's AxiosError.from does), so when the class differs from `name` both are shown.
 */
function thrown(e) {
  const name = e?.name ?? typeof e
  const ctor = e?.constructor?.name
  return ctor && ctor !== name && ctor !== 'Error' && ctor !== 'DOMException' ? `throws ${ctor} (name: ${name})` : `throws ${name}`
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
    .then(v => describe(v, expected), thrown)
  const outcome = await Promise.race([settled, waiting])
  clearTimeout(timer)
  return { outcome, ms: Math.round(performance.now() - started) }
}
