// Keynote's composition: the editor floats on a transparent stage (the page draws the
// black and the light behind it). Each slide opens with the editor easing up out of the
// dark; on a slide with a preview, that preview slides in beside it (below it on a phone).
// Everything here is driven by the frame, so pausing, seeking and replaying stay exact.
import React from 'react'
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { IDE } from '../engine/IDE'
import { SearchPreview } from '../engine/SearchPreview'
import { PREVIEWS } from '../engine/previews'
import { SLIDES } from '../engine/slides'
import { stateAt, type EditorState } from '../engine/timeline'
import { keynoteIde, keynotePreview } from './theme'

export type Layout = 'wide' | 'tall'

/** Composition size per layout: wide beside the captions, tall under them on a phone. */
export const SIZE: Record<Layout, { width: number; height: number }> = {
  wide: { width: 1600, height: 1120 },
  tall: { width: 1000, height: 1200 },
}
export { FPS } from '../length'

/** Code size per layout, in composition pixels. Tall is as large as a 64-column line allows. */
const FONT: Record<Layout, number> = { wide: 28, tall: 22 }

export type StageProps = {
  slide: number
  layout: Layout
  /** Reduced motion: no scale or slide, only fades. */
  still: boolean
}

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const ease = Easing.bezier(0.16, 1, 0.3, 1)

/** How far to pull the camera back so an open type hover fits the editor's width (1 = not at all). */
function hoverFit(state: EditorState, fontSize: number, width: number): number {
  if (!state.hover) return 1
  const file = state.files.find(f => f.name === state.active)
  if (!file || state.cursor.file !== file.name) return 1
  const before = file.text.slice(0, state.cursor.offset).split('\n')
  const col = before[before.length - 1].length
  const ch = fontSize * 0.6 // IBM Plex Mono's advance
  const left = Math.round(fontSize * 3.4) + Math.max(0, col - 4) * ch
  const longest = Math.max(...state.hover.text.split('\n').map(l => l.length))
  const need = left + longest * ch * 0.8 + 40
  const target = Math.min(1, width / need)
  const { local, span } = state.hover
  const env = interpolate(local, [0, 10, span - 10, span], [0, 1, 1, 0], { ...clamp, easing: ease })
  return 1 - (1 - target) * env
}

export const Stage: React.FC<StageProps> = ({ slide, layout, still }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const timeline = SLIDES[slide]
  const state = stateAt(timeline, frame)
  const wide = layout === 'wide'
  const { width: W, height: H } = SIZE[layout]
  const inset = wide ? 40 : 24
  const gap = wide ? 32 : 24
  const innerW = W - inset * 2
  const innerH = H - inset * 2

  // The entrance: up from 0.96 and out of the black, on a spring with no overshoot.
  const enter = still ? 1 : spring({ frame, fps, config: { damping: 200 }, durationInFrames: 34 })
  const fade = interpolate(frame, [0, still ? 8 : 18], [0, 1], { ...clamp, easing: ease })

  // The dedupe slide: the preview arrives with the first run and stays.
  const firstPreview = timeline.placed.find(a => a.do === 'preview')
  const since = firstPreview ? frame - firstPreview.start : -1
  const split = since < 0 ? 0
    : still ? interpolate(since, [0, 8], [0, 1], clamp)
    : spring({ frame: since, fps, config: { damping: 200 }, durationInFrames: 28 })
  const mode = state.previewIndex <= 0 ? 'plain' : 'dedupe'
  // Slides 4–9 each have their own preview panel (../engine/previews).
  const Panel = PREVIEWS[timeline.script.id]

  const previewW = wide ? Math.round(innerW * 0.33) : innerW
  const previewH = wide ? innerH : 600
  const editorW = wide ? innerW - (previewW + gap) * split : innerW
  const editorH = wide ? innerH : innerH - (previewH + gap) * split
  // Beside the preview the code steps down a size so a 64-column line still fits.
  const fontSize = wide ? FONT.wide * (1 - 0.2 * split) : FONT.tall
  const zoom = hoverFit(state, fontSize, editorW)

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute', left: inset, top: inset, width: editorW, height: editorH,
          opacity: fade, scale: String(0.96 + 0.04 * enter), transformOrigin: '50% 45%',
          borderRadius: keynoteIde.radius,
          boxShadow: '0 1px 0 rgba(255,255,255,0.06) inset, 0 40px 120px rgba(0,0,0,0.7)',
        }}
      >
        <div style={{ width: editorW / zoom, height: editorH / zoom, scale: String(zoom), transformOrigin: '0 0' }}>
          <IDE
            timeline={timeline}
            theme={{ ...keynoteIde, fontSize, radius: keynoteIde.radius / zoom }}
            width={editorW / zoom}
            height={editorH / zoom}
            focusAt={0.42}
            dimOthers={0.22}
          />
        </div>
      </div>
      {split > 0 && (
        <div
          style={{
            position: 'absolute', width: previewW, height: previewH, opacity: split,
            ...(wide ? { right: inset, top: inset } : { left: inset, bottom: inset }),
            translate: still ? undefined : wide ? `${(1 - split) * 70}px 0` : `0 ${(1 - split) * 70}px`,
          }}
        >
          {timeline.script.id === 'dedupe'
            ? <SearchPreview mode={mode} frame={state.previewFrame ?? 0} width={previewW} height={previewH} theme={keynotePreview} />
            : Panel && <Panel frame={state.previewFrame ?? 0} index={Math.max(0, state.previewIndex)} width={previewW} height={previewH} theme={keynotePreview} />}
        </div>
      )}
    </AbsoluteFill>
  )
}
