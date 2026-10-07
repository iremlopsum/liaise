import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { copyWithFeedback } from '../src/scripts/copy'

const fakeButton = () => {
  const label = { textContent: 'Copy' }
  return { label, button: { dataset: {} as Record<string, string | undefined>, querySelector: (s: string) => (s === '[data-label]' ? label : null) } }
}

describe('copyWithFeedback', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('says Copied, announces it, then restores the label after the delay', async () => {
    const { button, label } = fakeButton()
    const status = { textContent: '' as string | null }
    const writeText = vi.fn().mockResolvedValue(undefined)
    expect(await copyWithFeedback(button, 'npm install liaise', { clipboard: { writeText }, status, ms: 1000 })).toBe(true)
    expect(writeText).toHaveBeenCalledWith('npm install liaise')
    expect(label.textContent).toBe('Copied ✓')
    expect(button.dataset.copied).toBe('')
    expect(status.textContent).toBe('Copied to clipboard')
    vi.advanceTimersByTime(1000)
    expect(label.textContent).toBe('Copy')
    expect(button.dataset.copied).toBeUndefined()
    expect(status.textContent).toBe('')
  })

  it('says Press ⌘C and runs onFail when the clipboard refuses, and when there is none', async () => {
    for (const clipboard of [{ writeText: () => Promise.reject(new Error('denied')) }, undefined]) {
      const { button, label } = fakeButton()
      const onFail = vi.fn()
      expect(await copyWithFeedback(button, 'x', { clipboard, status: null, onFail })).toBe(false)
      expect(label.textContent).toBe('Press ⌘C')
      expect(button.dataset.copied).toBeUndefined()
      expect(onFail).toHaveBeenCalledOnce()
    }
  })

  it('takes the button as a parameter and never touches an event: feedback shows after the await', async () => {
    const { button, label } = fakeButton()
    let release!: () => void
    const writeText = () => new Promise<void>(r => (release = r))
    const p = copyWithFeedback(button, 'x', { clipboard: { writeText }, status: null })
    expect(label.textContent).toBe('Copy')
    release()
    await p
    expect(label.textContent).toBe('Copied ✓')
  })

  it('a second click inside the delay still restores the original label', async () => {
    const { button, label } = fakeButton()
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    await copyWithFeedback(button, 'x', { clipboard, status: null, ms: 1000 })
    await copyWithFeedback(button, 'x', { clipboard, status: null, ms: 1000 })
    vi.advanceTimersByTime(1000)
    expect(label.textContent).toBe('Copy')
  })
})
