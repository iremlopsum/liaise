import { describe, it, expect } from 'vitest'
import { createPager, type Pager, type PagerState } from 'liaise'
import { successResult } from 'liaise/testing'

// Minimal stand-ins with the frameworks' real signatures: enough to run each adapter.

// React: subscribes once, and re-renders (here: counts) when the store says it changed.
let reactRenders = 0
let reactUnsubscribe: (() => void) | undefined
function useSyncExternalStore<S>(subscribe: (onStoreChange: () => void) => () => void, getSnapshot: () => S): S {
  reactUnsubscribe ??= subscribe(() => { reactRenders += 1 })
  return getSnapshot()
}

// Vue: a ref with a `.value`, and the hook that runs when the component's scope ends.
type ShallowRef<T> = { value: T }
const shallowRef = <T,>(value: T): ShallowRef<T> => ({ value })
let vueDispose: (() => void) | undefined
const onScopeDispose = (fn: () => void) => { vueDispose = fn }

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

// example:pager-react:start
function usePager<P, R, T>(pager: Pager<P, R, T>): PagerState<P, R, T> {
  return useSyncExternalStore(pager.subscribe, () => pager.state)
}
// example:pager-react:end

// example:pager-vue:start
function usePagerState<P, R, T>(pager: Pager<P, R, T>): ShallowRef<PagerState<P, R, T>> {
  const state = shallowRef(pager.state)
  onScopeDispose(pager.subscribe(() => { state.value = pager.state }))
  return state
}
// example:pager-vue:end

// example:pager-svelte:start
function pagerStore<P, R, T>(pager: Pager<P, R, T>): Readable<PagerState<P, R, T>> {
  return readable(pager.state, set => {
    set(pager.state) // a move made before the first subscriber
    return pager.subscribe(() => set(pager.state))
  })
}
// example:pager-svelte:end

describe('each adapter sees the new state after a move', () => {
  it('React: the store tells React to render again, and the snapshot is the new state', async () => {
    const pager = makePager()
    expect(usePager(pager).page).toBeNull()
    await pager.load()
    await pager.goTo(2)
    expect(reactRenders).toBeGreaterThan(0)
    expect(usePager(pager)).toBe(pager.state)
    expect(usePager(pager).data).toEqual({ page: 2 })
    // The same object until something changes, as useSyncExternalStore requires.
    expect(usePager(pager)).toBe(usePager(pager))
    reactUnsubscribe!()
  })

  it('Vue: the ref holds the new state, and the scope ending unsubscribes', async () => {
    const pager = makePager()
    const state = usePagerState(pager)
    await pager.load()
    await pager.goTo(2)
    expect(state.value.page).toBe(2)
    vueDispose!()
    await pager.goTo(1)
    expect(state.value.page).toBe(2)
  })

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
