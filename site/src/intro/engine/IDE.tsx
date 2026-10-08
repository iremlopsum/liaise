// The typing editor, rendered from the timeline at the current frame. Everything moves
// through useCurrentFrame() + interpolate (Remotion renders frame by frame; CSS
// transitions would not), so the Player can pause, seek and replay exactly.
import React from 'react'
import { Easing, interpolate, useCurrentFrame } from 'remotion'
import type { IdeTheme } from './theme'
import { tokenizeLine } from './tokenize'
import type { EditorState, Timeline } from './timeline'
import { stateAt } from './timeline'

const ease = Easing.bezier(0.16, 1, 0.3, 1)
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** Line and column of `offset` in `text`. */
function lineCol(text: string, offset: number) {
  const before = text.slice(0, offset).split('\n')
  return { line: before.length - 1, col: before[before.length - 1].length }
}

export type IdeProps = {
  timeline: Timeline
  theme: IdeTheme
  /** Size of the editor in composition pixels; it scrolls to keep the cursor in view. */
  width: number
  height: number
  /** Where the cursor line sits when the editor scrolls (0 = top, 1 = bottom). */
  focusAt?: number
  /** Show the tab bar. */
  tabs?: boolean
  /** Dim lines far from the cursor (0 = off, 1 = strong), for a focus effect. */
  dimOthers?: number
}

/** The typing editor. */
export const IDE: React.FC<IdeProps> = ({ timeline, theme: t, width, height, focusAt = 0.45, tabs = true, dimOthers = 0 }) => {
  const frame = useCurrentFrame()
  const state = stateAt(timeline, frame)
  const file = state.files.find(f => f.name === state.active) ?? state.files[0]
  const lines = file.text.split('\n')
  const lh = t.fontSize * t.lineHeight
  const tabH = tabs ? Math.round(t.fontSize * 2.4) : 0
  const bodyH = height - tabH
  const padTop = lh * 0.8
  const gutter = Math.round(t.fontSize * 3.4)
  const cur = state.cursor.file === file.name ? lineCol(file.text, state.cursor.offset) : { line: -1, col: 0 }

  // Scroll: the cursor line's ideal offset, averaged over recent frames so it glides.
  const targetFor = (s: EditorState) => {
    const f = s.files.find(x => x.name === s.active)
    if (!f) return 0
    const { line } = lineCol(f.text, s.cursor.file === f.name ? s.cursor.offset : f.text.length)
    // An open hover or completion list needs room below the cursor, so aim higher and
    // allow scrolling past the last line.
    const boxOpen = s.hover || s.popup
    const total = f.text.split('\n').length * lh + padTop * 2 + (boxOpen ? lh * 8 : 0)
    return Math.max(0, Math.min(line * lh + padTop - bodyH * (boxOpen ? Math.min(focusAt, 0.3) : focusAt), total - bodyH))
  }
  let scroll = 0
  const samples = [0, 2, 4, 6, 8, 10]
  for (const back of samples) scroll += targetFor(back === 0 ? state : stateAt(timeline, Math.max(0, frame - back)))
  scroll /= samples.length
  scroll = Math.max(0, scroll)

  const blinkOn = state.typing || Math.floor(frame / 16) % 2 === 0
  const flashLine = state.flash && state.flash.file === file.name ? lines.findIndex(l => l.includes(state.flash!.match)) : -1
  const flashAlpha = state.flash ? interpolate(state.flash.local, [0, 8, state.flash.span - 12, state.flash.span], [0, 1, 1, 0], clamp) : 0

  const popup = state.popup
  const popAppear = popup ? interpolate(popup.local, [0, 6], [0, 1], { ...clamp, easing: ease }) : 0
  const popLeave = popup ? interpolate(popup.local, [popup.span - 5, popup.span], [1, 0], clamp) : 0
  const hover = state.hover
  const hoverAlpha = hover ? interpolate(hover.local, [0, 8, hover.span - 8, hover.span], [0, 1, 1, 0], clamp) : 0

  // The word being completed: what was typed after the last '.' on the cursor line.
  const typedWord = cur.line >= 0 ? (lines[cur.line].slice(0, cur.col).match(/[\w$]*$/)?.[0] ?? '') : ''

  return (
    <div style={{ width, height, background: t.bg, borderRadius: t.radius, overflow: 'hidden', position: 'relative', boxShadow: `0 0 0 1px ${t.border}`, fontFamily: t.font }}>
      {tabs && (
        <div style={{ height: tabH, display: 'flex', alignItems: 'stretch', background: t.tabBar, borderBottom: `1px solid ${t.border}`, fontSize: t.fontSize * 0.72 }}>
          {t.chrome === 'mac' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: t.fontSize * 0.4, padding: `0 ${t.fontSize}px` }}>
              {['#ff5f57', '#febc2e', '#28c840'].map(c => <span key={c} style={{ width: t.fontSize * 0.55, height: t.fontSize * 0.55, borderRadius: 99, background: c, opacity: 0.9 }} />)}
            </div>
          )}
          {state.files.map(f => {
            const on = f.name === state.active
            return (
              <div key={f.name} style={{ display: 'flex', alignItems: 'center', padding: `0 ${t.fontSize * 1.1}px`, color: on ? t.tabActiveText : t.tabText, background: on ? t.tabActiveBg : 'transparent', borderRight: `1px solid ${t.border}`, position: 'relative' }}>
                {f.name}
                {on && <span style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 2, background: t.cursor }} />}
              </div>
            )
          })}
        </div>
      )}
      <div style={{ position: 'absolute', top: tabH, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
        <div style={{ translate: `0 ${-scroll}px`, paddingTop: padTop, fontSize: t.fontSize, lineHeight: `${lh}px`, position: 'relative' }}>
          {lines.map((line, i) => {
            const distance = cur.line < 0 ? 0 : Math.abs(i - cur.line)
            const dim = dimOthers ? interpolate(distance, [0, 3, 10], [1, 1 - dimOthers * 0.45, 1 - dimOthers * 0.8], clamp) : 1
            return (
              <div key={i} style={{ display: 'flex', height: lh, position: 'relative', background: i === flashLine ? t.flash.replace(/[\d.]+\)$/, m => `${parseFloat(m) * flashAlpha})`) : i === cur.line ? t.activeLine : 'transparent' }}>
                <span style={{ width: gutter, flex: 'none', textAlign: 'right', paddingRight: t.fontSize * 1.1, color: t.lineNumber, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                <span style={{ whiteSpace: 'pre', opacity: dim, position: 'relative' }}>
                  {tokenizeLine(line).map((tok, k) => <span key={k} style={{ color: t.tokens[tok.kind] }}>{tok.text}</span>)}
                  {i === cur.line && (
                    <span style={{ position: 'absolute', left: `${cur.col}ch`, top: lh * 0.14, width: Math.max(2, t.fontSize * 0.1), height: lh * 0.72, background: t.cursor, opacity: blinkOn ? 1 : 0, borderRadius: 1 }} />
                  )}
                </span>
              </div>
            )
          })}

          {popup && cur.line >= 0 && (
            // The anchor keeps the editor's font size, so `ch` means a code column; the list inside is smaller.
            <div style={{ position: 'absolute', left: `calc(${gutter}px + ${Math.max(0, cur.col - typedWord.length)}ch)`, top: padTop + (cur.line + 1) * lh + 6, width: 0, height: 0, zIndex: 2 }}>
            <div style={{ position: 'absolute', left: 0, top: 0, minWidth: '22ch', maxWidth: width * 0.8, background: t.popupBg, border: `1px solid ${t.popupBorder}`, borderRadius: 12, boxShadow: t.shadow, padding: 6, fontSize: t.fontSize * 0.82, opacity: popAppear * popLeave, scale: String(0.97 + 0.03 * popAppear), transformOrigin: 'top left' }}>
              {popup.items.map((item, k) => (
                <div key={item.label} style={{ display: 'flex', gap: '1.2ch', alignItems: 'baseline', padding: '6px 10px', borderRadius: 8, background: k === popup.selected ? t.popupSelected : 'transparent', whiteSpace: 'nowrap' }}>
                  <span style={{ color: item.kind === 'method' ? t.tokens.keyword : t.tokens.type, fontSize: '0.8em', width: '1.4ch' }}>{item.kind === 'method' ? 'ƒ' : '◆'}</span>
                  <span style={{ color: t.popupText }}>
                    <span style={{ color: t.popupMatch, fontWeight: 600 }}>{item.label.slice(0, typedWord.length)}</span>{item.label.slice(typedWord.length)}
                  </span>
                  <span style={{ color: t.popupDetail, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.detail}</span>
                </div>
              ))}
            </div>
            </div>
          )}

          {hover && cur.line >= 0 && (
            <div style={{ position: 'absolute', left: `calc(${gutter}px + ${Math.max(0, cur.col - 4)}ch)`, top: padTop + (cur.line + 1) * lh + 6, width: 0, height: 0, zIndex: 2 }}>
            <div style={{ position: 'absolute', left: 0, top: 0, background: t.popupBg, border: `1px solid ${t.popupBorder}`, borderRadius: 12, boxShadow: t.shadow, padding: '12px 16px', fontSize: t.fontSize * 0.8, lineHeight: 1.55, whiteSpace: 'pre', color: t.popupText, opacity: hoverAlpha, translate: `0 ${(1 - hoverAlpha) * 6}px` }}>
              {hover.text.split('\n').map((l, k) => (
                <div key={k}>{tokenizeLine(l).map((tok, j) => <span key={j} style={{ color: t.tokens[tok.kind] }}>{tok.text}</span>)}</div>
              ))}
            </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
