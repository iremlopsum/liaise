import { describe, it, expect } from 'vitest'
import { createPager, type Pager, type PagerState } from 'liaise'
import { successResult } from 'liaise/testing'

// A minimal stand-in with the framework's real signature: enough to run the adapter.

// React: subscribes once, and re-renders (here: counts) when the store says it changed.
let reactRenders = 0
let reactUnsubscribe: (() => void) | undefined
function useSyncExternalStore<S>(subscribe: (onStoreChange: () => void) => () => void, getSnapshot: () => S): S {
  reactUnsubscribe ??= subscribe(() => { reactRenders += 1 })
  return getSnapshot()
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

describe('the adapter sees the new state after a move', () => {
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
})
