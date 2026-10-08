import { describe, it, expect, vi, afterEach } from 'vitest'
import { INTRO_KEY, rememberIntro } from '../src/intro/flag'

afterEach(() => { vi.unstubAllGlobals() })

describe('rememberIntro', () => {
  it("stores how the intro ended under the site's own key", () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    rememberIntro('skipped')
    expect(INTRO_KEY).toBe('liaise:intro')
    expect(setItem).toHaveBeenCalledWith('liaise:intro', 'skipped')
  })
  it('never throws when storage does, or is missing', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new DOMException('blocked', 'SecurityError') } })
    expect(() => rememberIntro('done')).not.toThrow()
    vi.stubGlobal('localStorage', undefined)
    expect(() => rememberIntro('done')).not.toThrow()
  })
})
