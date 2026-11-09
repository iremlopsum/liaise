import { describe, it, expect } from 'vitest'
import { createPager, type Pager, type PagerState } from 'liaise'
import { successResult } from 'liaise/testing'

// A minimal stand-in with the framework's real signature: enough to run the adapter.

// Svelte: a readable store, started by its first subscriber and stopped by its last.
type Readable<T> = { subscribe(run: (value: T) => void): () => void }
function readable<T>(initial: T, start: (set: (value: T) => void) => () => void): Readable<T> {
  let value = initial
  const runs = new Set<(value: T) => void>()
  let stop: (() => void) | undefined
  return {
    subscribe(run) {
      runs.add(run)
      // As Svelte does: a set() while starting changes the value without notifying.
      if (runs.size === 1) stop = start(v => { value = v; if (stop) runs.forEach(r => r(v)) })
      run(value)
      return () => { runs.delete(run); if (runs.size === 0) { stop?.(); stop = undefined } }
    },
  }
}

// A numbered pager over an endpoint that answers at once with its page number.
type Params = { page: number }
const endpoint = async (params: Params) => successResult({ page: params.page })
const makePager = () => createPager(endpoint, { page: 1 }, { toParams: page => ({ page }) })

// example:pager-svelte:start
function pagerStore<P, R, T>(pager: Pager<P, R, T>): Readable<PagerState<P, R, T>> {
  return readable(pager.state, set => {
    set(pager.state) // a move made before the first subscriber
    return pager.subscribe(() => set(pager.state))
  })
}
// example:pager-svelte:end

describe('the adapter sees the new state after a move', () => {
  it('Svelte: subscribers get the new state, including a move made before they subscribed', async () => {
    const pager = makePager()
    const store = pagerStore(pager)
    await pager.load()
    const seen: (number | null)[] = []
    const unsubscribe = store.subscribe(s => seen.push(s.page))
    expect(seen).toEqual([1])
    await pager.goTo(2)
    expect(seen.at(-1)).toBe(2)
    unsubscribe()
    await pager.goTo(1)
    expect(seen.at(-1)).toBe(2)
  })
})
