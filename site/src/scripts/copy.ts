// One behaviour for every Copy button on the site (the install pill, the code blocks). Everything
// is read from the arguments before the first await: an event's currentTarget is reset to null
// once dispatch ends, so reading it after `await writeText` throws and no feedback ever shows.
export interface CopyOptions {
  clipboard?: Pick<Clipboard, 'writeText'> | undefined
  label?: { textContent: string | null }
  status?: { textContent: string | null } | null
  /** Runs when the clipboard refused, to select the text so the user can copy by hand. */
  onFail?: () => void
  ms?: number
}
interface ButtonLike {
  dataset: Record<string, string | undefined>
  querySelector(selector: string): any
}

const timers = new WeakMap<object, ReturnType<typeof setTimeout>>()

export async function copyWithFeedback(button: ButtonLike, text: string, opts: CopyOptions = {}): Promise<boolean> {
  const clipboard = 'clipboard' in opts ? opts.clipboard : globalThis.navigator?.clipboard
  const label = opts.label ?? button.querySelector('[data-label]') ?? (button as unknown as { textContent: string | null })
  const status = 'status' in opts ? opts.status : globalThis.document?.getElementById('copy-status')
  const ms = opts.ms ?? 1600
  const rest = timers.has(button) ? (button.dataset.copyRest ?? label.textContent) : label.textContent
  button.dataset.copyRest = rest ?? ''
  clearTimeout(timers.get(button))

  let ok = true
  try {
    if (!clipboard) throw new Error('no clipboard')
    await clipboard.writeText(text)
  } catch {
    ok = false
    opts.onFail?.()
  }

  label.textContent = ok ? 'Copied ✓' : 'Press ⌘C'
  if (ok) button.dataset.copied = ''
  else delete button.dataset.copied
  if (status) status.textContent = ok ? 'Copied to clipboard' : 'Could not copy. Press Command C or Control C to copy the selected text.'
  timers.set(button, setTimeout(() => {
    label.textContent = rest
    delete button.dataset.copied
    if (status) status.textContent = ''
    timers.delete(button)
  }, ms))
  return ok
}
