import { describe, it, expect } from 'vitest'
import { createPager, type Pager, type PagerState } from 'liaise'
import { successResult } from 'liaise/testing'

// A minimal stand-in with the framework's real signature: enough to run the adapter.

// Vue: a ref with a `.value`, and the hook that runs when the component's scope ends.
type ShallowRef<T> = { value: T }
const shallowRef = <T,>(value: T): ShallowRef<T> => ({ value })
let vueDispose: (() => void) | undefined
const onScopeDispose = (fn: () => void) => { vueDispose = fn }

// A numbered pager over an endpoint that answers at once with its page number.
type Params = { page: number }
const endpoint = async (params: Params) => successResult({ page: params.page })
const makePager = () => createPager(endpoint, { page: 1 }, { toParams: page => ({ page }) })

// example:pager-vue:start
function usePagerState<P, R, T>(pager: Pager<P, R, T>): ShallowRef<PagerState<P, R, T>> {
  const state = shallowRef(pager.state)
  onScopeDispose(pager.subscribe(() => { state.value = pager.state }))
  return state
}
// example:pager-vue:end

describe('the adapter sees the new state after a move', () => {
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
})
