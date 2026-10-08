// The search from Search.tsx with dedupe: true and cacheMiddleware({ ttl: 60_000 }) on
// searchUsers, plus the recent-search chips. Slowed down 4x, like SearchPreview, whose
// timings it reuses (calls('dedupe')). Index 0 types "ada": the 'a' and 'ad' calls are
// cancelled, '?q=ada' answers and is stored. Index 1 continues the same page: a click on
// "grace" sends one request; a click on "ada" is answered by the cache before liaise sends
// anything (the cache is endpoint middleware, so it answers before the core fetches), and
// nothing was in flight, so dedupe has nothing to cancel.
//
// The input is controlled: a chip calls search(name), which sets the box's text to the
// chip's name and then makes the call, so the box always says what the results are for.
import React from 'react'
import { Easing, interpolate } from 'remotion'
import { calls, type Call } from '../SearchPreview'
import type { PreviewProps, PreviewTheme } from './types'

const SLOW = 4
const MS = (ms: number) => Math.round((ms / 1000) * 30 * SLOW) // ms -> frames at 30 fps, slowed
const TYPING = calls('dedupe')
/** Index 0 runs 130 frames; index 1's frame 0 is frame 130 of one continuous page. */
const RUN0 = 130
const RUN1 = 150
const GRACE_CLICK = 22
const ADA_CLICK = 100
const GRACE: Call = { q: 'grace', start: RUN0 + GRACE_CLICK, land: RUN0 + GRACE_CLICK + MS(300), cancelledAt: null }
const REQUESTS: Call[] = [...TYPING, GRACE]
const TYPED = TYPING[TYPING.length - 1] // ?q=ada, the one that lands

const PEOPLE: Record<string, string[]> = { ada: ['Ada Lovelace'], grace: ['Grace Hopper'] }

type Shown = { at: number; q: string; how: 'typed' | 'network' | 'cache' }
/** Each answer that reaches the list, in order. */
const SHOWN: Shown[] = [
  { at: TYPED.land, q: 'ada', how: 'typed' },
  { at: GRACE.land, q: 'grace', how: 'network' },
  { at: RUN0 + ADA_CLICK, q: 'ada', how: 'cache' },
]
/** What the cache holds: only answers that succeeded (the cancelled calls are errors). */
const STORED = [{ q: 'ada', at: TYPED.land }, { q: 'grace', at: GRACE.land }]

const CHIPS = [{ q: 'ada', w: 70 }, { q: 'grace', w: 92 }, { q: 'alan', w: 76 }]
const CHIP_H = 40
const CHIP_GAP = 10
const chipX = (q: string) => {
  let x = 0
  for (const c of CHIPS) {
    if (c.q === q) return x + c.w / 2
    x += c.w + CHIP_GAP
  }
  return 0
}

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const ease = Easing.inOut(Easing.cubic)

/** The pointer in index 1, relative to the chip row: rest, to "grace", click, to "ada", click. */
function pointerAt(l: number): { x: number; y: number; down: boolean } {
  const rest = { x: 300, y: 190 }
  // The tip lands low and right of the label's centre, so the label stays readable.
  const grace = { x: chipX('grace') + 22, y: CHIP_H - 12 }
  const ada = { x: chipX('ada') + 18, y: CHIP_H - 12 }
  const toGrace = interpolate(l, [4, 18], [0, 1], { ...clamp, easing: ease })
  const toAda = interpolate(l, [72, 92], [0, 1], { ...clamp, easing: ease })
  const from = toAda > 0 ? grace : rest
  const to = toAda > 0 ? ada : grace
  const p = toAda > 0 ? toAda : toGrace
  const down = (l >= GRACE_CLICK - 2 && l < GRACE_CLICK + 3) || (l >= ADA_CLICK - 2 && l < ADA_CLICK + 3)
  return { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p, down }
}

const Pointer: React.FC<{ down: boolean; t: PreviewTheme }> = ({ down, t }) => (
  <svg width={26} height={30} viewBox="0 0 26 30" style={{ scale: down ? '0.86' : '1', transformOrigin: '2px 2px' }}>
    <path d="M2 2v22l5.6-5.3 4 8.6 4-1.8-4-8.4H19.5z" fill={t.fg} stroke={t.bg} strokeWidth={1.6} strokeLinejoin="round" />
  </svg>
)

export const TogetherPreview: React.FC<PreviewProps> = ({ frame, index, width, height, theme: t }) => {
  // One page across both runs: g is the frame since the first run started.
  const g = index === 0 ? frame : RUN0 + frame
  // What the box says: the keystrokes, then each clicked chip's name (search() sets it).
  const clicked = [{ at: RUN0 + GRACE_CLICK, q: 'grace' }, { at: RUN0 + ADA_CLICK, q: 'ada' }].filter(c => g >= c.at).pop()
  const typed = clicked?.q ?? TYPING.filter(c => g >= c.start).map(c => c.q).pop() ?? ''
  const focused = g < RUN0 + GRACE_CLICK // the first chip click moves focus to the button
  const shown = SHOWN.filter(s => g >= s.at).pop() ?? null
  const fade = shown === null || shown.how === 'cache' ? 1
    : interpolate(g - shown.at, [0, 6], [0.2, 1], { ...clamp, easing: Easing.out(Easing.quad) })
  const pointer = index === 1 ? pointerAt(frame) : null
  const hoverChip = pointer === null ? null
    : frame >= 18 && frame < 72 ? 'grace' : frame >= 92 ? 'ada' : null

  // The network waterfall: index 0 on SearchPreview's scale; index 1 zooms out to both runs.
  const span = index === 0 ? Math.max(...TYPING.map(c => c.land)) + 6
    : interpolate(frame, [0, 14], [Math.max(...TYPING.map(c => c.land)) + 6, RUN0 + RUN1], { ...clamp, easing: ease })
  const scale = (x: number) => Math.min(1, x / span)

  return (
    <div style={{ width, height, background: t.bg, color: t.fg, borderRadius: t.radius, boxShadow: `0 0 0 1px ${t.line}`, padding: 28, boxSizing: 'border-box', fontFamily: t.font, display: 'flex', flexDirection: 'column', gap: 18, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 16, color: t.muted }}>
        <span style={{ fontWeight: 600, color: t.fg, fontSize: 18 }}>{'<Search />'}</span>
        <span>dedupe + cache · 4× slower than real</span>
      </div>

      <div style={{ border: `1.5px solid ${focused ? t.accent : t.line}`, background: t.field, borderRadius: 12, padding: '14px 16px', fontSize: 22 }}>
        {typed}
        <span style={{ display: 'inline-block', width: 2, height: 24, background: t.accent, marginLeft: 2, verticalAlign: '-4px', opacity: focused && Math.floor(frame / 15) % 2 === 0 ? 1 : 0 }} />
      </div>

      {/* The recent searches, and the pointer that clicks them in the second run. */}
      <div style={{ position: 'relative', display: 'flex', gap: CHIP_GAP, height: CHIP_H, zIndex: 1 }}>
        {CHIPS.map(c => {
          const pressed = pointer?.down === true && hoverChip === c.q
          return (
            <span key={c.q} style={{
              width: c.w, height: CHIP_H, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 999, fontSize: 17, border: `1.5px solid ${pressed ? t.accent : t.line}`,
              background: hoverChip === c.q ? t.line : t.field, scale: pressed ? '0.95' : '1',
            }}>{c.q}</span>
          )
        })}
        {pointer && (
          <span style={{ position: 'absolute', left: pointer.x - 2, top: pointer.y - 2, opacity: interpolate(frame, [0, 4], [0, 1], clamp) }}>
            <Pointer down={pointer.down} t={t} />
          </span>
        )}
      </div>

      <div style={{ minHeight: 120, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown && PEOPLE[shown.q].map(name => (
          <div key={shown.q + name} style={{ fontSize: 20, padding: '6px 2px', borderBottom: `1px solid ${t.line}`, opacity: fade }}>{name}</div>
        ))}
        {shown?.how === 'typed' && g >= shown.at + 4 && (
          <span style={{ marginTop: 6, alignSelf: 'flex-start', background: t.okSoft, color: t.ok, borderRadius: 999, padding: '6px 12px', fontSize: 16, fontWeight: 600 }}>Matches what was typed</span>
        )}
        {shown?.how === 'network' && (
          <span style={{ marginTop: 6, alignSelf: 'flex-start', background: t.line, color: t.fg, borderRadius: 999, padding: '6px 12px', fontSize: 16, fontWeight: 600 }}>from the network · 300 ms</span>
        )}
        {shown?.how === 'cache' && (
          <span style={{ marginTop: 6, alignSelf: 'flex-start', background: t.okSoft, color: t.ok, borderRadius: 999, padding: '6px 12px', fontSize: 16, fontWeight: 600 }}>from cache · 0 ms</span>
        )}
      </div>

      {/* Both lists are sized for their final rows up front, so nothing moves when one arrives. */}
      <div style={{ marginTop: 'auto', flex: 'none', minHeight: 22 + STORED.length * 32, display: 'flex', flexDirection: 'column', gap: 10, fontFamily: t.mono, fontSize: 16, lineHeight: '22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: t.font, color: t.muted }}>
          <span style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>Cache</span>
          <span>ttl 1 min</span>
        </div>
        {STORED.filter(s => g >= s.at).length === 0 && <span style={{ color: t.muted }}>empty</span>}
        {STORED.filter(s => g >= s.at).map(s => {
          const hit = s.q === 'ada' && g >= RUN0 + ADA_CLICK
          return (
            <div key={s.q} style={{ display: 'grid', gridTemplateColumns: '1fr 7ch', gap: 10, opacity: interpolate(g - s.at, [0, 5], [0.3, 1], clamp) }}>
              <span>?q={s.q}</span>
              <span style={{ textAlign: 'right', color: hit ? t.ok : t.muted, fontWeight: hit ? 600 : 400 }}>{hit ? 'hit' : 'stored'}</span>
            </div>
          )
        })}
      </div>

      <div style={{ flex: 'none', minHeight: 22 + REQUESTS.length * 32, display: 'flex', flexDirection: 'column', gap: 10, fontFamily: t.mono, fontSize: 16, lineHeight: '22px' }}>
        <div style={{ color: t.muted, fontFamily: t.font, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Network</div>
        {REQUESTS.filter(c => g >= c.start).map(c => {
          const until = c.cancelledAt !== null && c.cancelledAt < c.land ? c.cancelledAt : c.land
          const done = g >= until
          const cancelled = c.cancelledAt !== null && c.cancelledAt < c.land && g >= c.cancelledAt
          const x0 = scale(c.start)
          const x1 = scale(Math.min(g, until))
          return (
            <div key={c.q} style={{ display: 'grid', gridTemplateColumns: '10.5ch 1fr 9ch', gap: 12, alignItems: 'center' }}>
              <span style={{ color: cancelled ? t.muted : t.fg, textDecoration: cancelled ? 'line-through' : 'none' }}>?q={c.q}</span>
              <span style={{ position: 'relative', height: 10 }}>
                <span style={{ position: 'absolute', left: `${x0 * 100}%`, width: `${Math.max(0.5, (x1 - x0) * 100)}%`, top: 0, bottom: 0, borderRadius: 4, background: cancelled ? t.line : t.accent, opacity: cancelled ? 1 : done ? 0.9 : 0.6 }} />
              </span>
              <span style={{ color: cancelled ? t.muted : done ? t.ok : t.muted, textAlign: 'right' }}>{cancelled ? 'cancelled' : done ? '200' : '…'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Frames of each run: index 0, index 1. */
export const TOGETHER_FRAMES = [RUN0, RUN1] as const

export default TogetherPreview
