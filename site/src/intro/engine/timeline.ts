// Turns a slide's script (type this, pause, show a completion list…) into the editor's
// state at any frame. Pure and deterministic, which is what Remotion needs: the same
// frame always renders the same picture, so scrubbing, pausing and replaying all work.

export type CompletionItem = { label: string; detail: string; kind: 'property' | 'method' | 'type' }

export type Action =
  /** Type `text` into `file`, at the end or right after the first occurrence of `after`. */
  | { do: 'type'; file: string; text: string; after?: string; cps?: number }
  /** Delete `text` from `file` with backspace, last character first. */
  | { do: 'erase'; file: string; text: string; cps?: number }
  | { do: 'pause'; frames: number }
  /** A caption marker: the page shows the caption with this id from here on. */
  | { do: 'cue'; id: string }
  /** Switch the editor to `file` (a new file appears as a new tab). */
  | { do: 'tab'; file: string; frames?: number }
  /** An autocomplete list at the cursor; the highlight walks to `select`. */
  | { do: 'popup'; items: CompletionItem[]; select: number; frames: number }
  /** A type tooltip at the cursor. */
  | { do: 'hover'; text: string; frames: number }
  /** Briefly highlight the line of `file` that contains `match`. */
  | { do: 'flash'; file: string; match: string; frames: number }
  /** The slide's live preview starts here and keeps running to the end. */
  | { do: 'preview'; frames: number }

export type SlideScript = {
  id: string
  /** Files present when the slide starts, in tab order. */
  initial: Array<[name: string, text: string]>
  active: string
  actions: Action[]
  /** Default typing speed, characters per frame (30 fps). */
  cps: number
  /** Frames to hold at the end before the page shows Copy / Next. */
  hold: number
}

type Placed = Action & { start: number; end: number }

export type Timeline = {
  script: SlideScript
  placed: Placed[]
  duration: number
  cues: Array<{ id: string; frame: number }>
}

export function compile(script: SlideScript): Timeline {
  let frame = 0
  const placed: Placed[] = []
  const cues: Array<{ id: string; frame: number }> = []
  for (const action of script.actions) {
    let length = 0
    switch (action.do) {
      case 'type': length = Math.ceil(action.text.length / (action.cps ?? script.cps)); break
      case 'erase': length = Math.ceil(action.text.length / (action.cps ?? script.cps * 2.5)); break
      case 'pause': case 'popup': case 'hover': case 'flash': case 'preview': length = action.frames; break
      case 'tab': length = action.frames ?? 10; break
      case 'cue': cues.push({ id: action.id, frame }); break
    }
    placed.push({ ...action, start: frame, end: frame + length })
    frame += length
  }
  return { script, placed, duration: frame + script.hold, cues }
}

export type EditorState = {
  files: Array<{ name: string; text: string }>
  active: string
  cursor: { file: string; offset: number }
  typing: boolean
  /** local: frames since it opened; span: how long it stays open. */
  popup: { items: CompletionItem[]; selected: number; local: number; span: number } | null
  hover: { text: string; local: number; span: number } | null
  flash: { file: string; match: string; local: number; span: number } | null
  /** Frames since the latest preview started, and which preview it is (0 = first). */
  previewFrame: number | null
  previewIndex: number
  cue: string | null
  cueFrame: number
}

/** The editor at `frame`. */
export function stateAt(t: Timeline, frame: number): EditorState {
  const files = new Map(t.script.initial)
  const order = t.script.initial.map(([name]) => name)
  let active = t.script.active
  let cursor = { file: active, offset: files.get(active)?.length ?? 0 }
  let typing = false
  let popup: EditorState['popup'] = null
  let hover: EditorState['hover'] = null
  let flash: EditorState['flash'] = null
  let previewFrame: number | null = null
  let previewIndex = -1
  let cue: string | null = null
  let cueFrame = 0

  for (const a of t.placed) {
    if (a.start > frame) break
    const local = frame - a.start
    const span = Math.max(1, a.end - a.start)
    const inside = frame < a.end
    switch (a.do) {
      case 'cue': cue = a.id; cueFrame = a.start; break
      case 'tab':
        if (!files.has(a.file)) { files.set(a.file, ''); order.push(a.file) }
        active = a.file
        cursor = { file: a.file, offset: files.get(a.file)!.length }
        break
      case 'type': {
        const text = files.get(a.file) ?? ''
        if (!files.has(a.file)) { order.push(a.file) }
        const at = a.after !== undefined && text.includes(a.after) ? text.indexOf(a.after) + a.after.length : text.length
        const n = inside ? Math.min(a.text.length, Math.floor(local * (a.cps ?? t.script.cps)) + 1) : a.text.length
        files.set(a.file, text.slice(0, at) + a.text.slice(0, n) + text.slice(at))
        active = a.file
        cursor = { file: a.file, offset: at + n }
        typing = inside
        break
      }
      case 'erase': {
        const text = files.get(a.file) ?? ''
        const at = text.indexOf(a.text)
        if (at < 0) break
        const gone = inside ? Math.min(a.text.length, Math.floor(local * (a.cps ?? t.script.cps * 2.5)) + 1) : a.text.length
        files.set(a.file, text.slice(0, at) + a.text.slice(0, a.text.length - gone) + text.slice(at + a.text.length))
        active = a.file
        cursor = { file: a.file, offset: at + a.text.length - gone }
        typing = inside
        break
      }
      case 'popup':
        if (inside) {
          const walk = Math.min(1, local / (span * 0.6))
          popup = { items: a.items, selected: Math.round(walk * a.select), local, span }
        }
        break
      case 'hover':
        if (inside) hover = { text: a.text, local, span }
        break
      case 'flash':
        if (inside) flash = { file: a.file, match: a.match, local, span }
        break
      case 'preview':
        previewFrame = local
        previewIndex++
        break
    }
  }
  return {
    files: order.map(name => ({ name, text: files.get(name) ?? '' })),
    active, cursor, typing, popup, hover, flash, previewFrame, previewIndex, cue, cueFrame,
  }
}

/** The caption id showing at `frame`, and the frame it started. */
export function cueAt(t: Timeline, frame: number): { id: string; frame: number } | null {
  let current: { id: string; frame: number } | null = null
  for (const c of t.cues) if (c.frame <= frame) current = c
  return current
}
