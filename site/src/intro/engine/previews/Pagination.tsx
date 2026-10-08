// The pagination slide's preview: the Blog component from Blog.tsx. A pointer clicks
// "Load more" four times. Clicks 1-3 each call pages.next(), which sends exactly one
// request, the cursor going along by itself (?limit=10, then &cursor=p2, &cursor=p3).
// Page 3 comes back without `next`, so click 4's pages.next() resolves { done: true }
// without sending anything, and setMore(false) removes the button. Requests are shown
// 4x slower than real (about 160 ms each). Frame-driven only.
import React from 'react'
import { Easing, interpolate } from 'remotion'
import type { PreviewProps } from './types'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const out = Easing.bezier(0.16, 1, 0.3, 1)
const inOut = Easing.inOut(Easing.cubic)

/** The pointer clicks "Load more" here. */
const CLICKS = [10, 70, 130, 175]
/** The three pages: one request each, sent by clicks 1-3. */
const PAGES = [
  { cursor: '', send: 11, land: 31, count: 10, next: 'p2', titles: ['Hello, world', 'Notes on HTTP caching', 'Our first year in numbers'] },
  { cursor: '&cursor=p2', send: 71, land: 91, count: 10, next: 'p3', titles: ['Cursor pagination, explained', 'Designing for slow networks', 'What a 503 taught us'] },
  { cursor: '&cursor=p3', send: 131, land: 149, count: 4, next: null, titles: ['Retries without a stampede', 'Smaller bundles, faster pages', 'A week without a framework'] },
] as const
/** Click 4: pages.next() is done, nothing is sent, the button goes. */
const DONE = CLICKS[3]
const AXIS: [number, number] = [0, 160]

const fadeIn = (frame: number, at: number, len = 6) => interpolate(frame, [at, at + len], [0, 1], { ...clamp, easing: out })

export const PaginationPreview: React.FC<PreviewProps> = ({ frame, width, height, theme: t }) => {
  const P = 28
  const W = width - P * 2
  const H = height - P * 2
  const cols = W >= 700 ? 3 : 1 // the phone layout's panel is wide and short: pages side by side

  // The network list sits at the bottom; the blog window takes the rest.
  const ROW = 26
  const netTop = H - (16 + 10 + 3 * ROW + 2 * 10)
  const winTop = 46
  const winH = netTop - 24 - winTop

  // Inside the window.
  const pad = 16
  const groupsTop = 64
  const ROW_H = 34
  const groupH = 30 + PAGES[0].titles.length * ROW_H + 28
  const gap = 14
  const groupW = cols === 1 ? W - pad * 2 : (W - pad * 2 - gap * 2) / 3
  const groupAt = (i: number) => cols === 1
    ? { x: pad, y: groupsTop + i * (groupH + gap) }
    : { x: pad + i * (groupW + gap), y: groupsTop }

  // The button follows the posts: below the last page that has landed.
  const BTN_W = 170
  const BTN_H = 48
  const btnY = (loaded: number) => cols === 1
    ? groupsTop + (loaded === 0 ? 40 : loaded * (groupH + gap))
    : groupsTop + (loaded === 0 ? 40 : groupH + gap)
  const btnX = (W - BTN_W) / 2
  let buttonTop = btnY(0)
  PAGES.forEach((p, i) => {
    if (frame >= p.land) buttonTop = interpolate(frame, [p.land, p.land + 10], [btnY(i), btnY(i + 1)], { ...clamp, easing: out })
  })
  const buttonGone = interpolate(frame, [DONE, DONE + 4], [1, 0], clamp)

  // The pointer: from a resting spot to the button before each click; a press, a ripple.
  const target = (k: number) => {
    const loaded = PAGES.filter(p => p.land <= CLICKS[k]).length
    return { x: btnX + BTN_W / 2 + 18, y: winTop + btnY(loaded) + BTN_H / 2 + 6 }
  }
  let pointer = { x: W * 0.82, y: winTop + groupsTop + 120 }
  CLICKS.forEach((c, k) => {
    const from = k === 0 ? 0 : c - 16
    const to = c - 2
    if (frame >= from) {
      const p = interpolate(frame, [from, to], [0, 1], { ...clamp, easing: inOut })
      const a = pointer
      const b = target(k)
      pointer = { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p }
    }
  })
  // After the last click the pointer drifts aside, off the "done" note.
  const aside = interpolate(frame, [DONE + 8, DONE + 22], [0, 1], { ...clamp, easing: inOut })
  pointer = { x: pointer.x + Math.min(150, W - pointer.x - 30) * aside, y: pointer.y + 70 * aside }
  const press = CLICKS.reduce((m, c) => Math.max(m, interpolate(frame, [c - 1, c + 1, c + 6], [0, 1, 0], clamp)), 0)
  const lastClick = [...CLICKS].reverse().find(c => frame >= c)

  const loadedPages = PAGES.filter(p => frame >= p.land)
  const posts = loadedPages.reduce((n, p) => n + p.count, 0)
  const scale = (f: number) => interpolate(f, AXIS, [0, 1], clamp)

  return (
    <div style={{ position: 'relative', width, height, background: t.bg, color: t.fg, borderRadius: t.radius, boxShadow: `0 0 0 1px ${t.line}`, fontFamily: t.font, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: P, top: P, width: W, height: H }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 16, color: t.muted, height: 26 }}>
          <span style={{ fontWeight: 600, color: t.fg, fontSize: 18 }}>{'<Blog />'}</span>
          <span>4× slower than real</span>
        </div>

        {/* The blog */}
        <div style={{ position: 'absolute', left: 0, top: winTop, width: W, height: winH, borderRadius: 16, background: t.field, border: `1px solid ${t.line}`, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: pad, right: pad, top: 0, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${t.line}` }}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>Blog</span>
            <span style={{ fontSize: 16, color: t.muted }}>
              <span style={{ color: posts ? t.accent : t.muted, fontWeight: 700, fontSize: 20, fontVariantNumeric: 'tabular-nums' }}>{posts}</span> posts
            </span>
          </div>

          {loadedPages.length === 0 && (
            <div style={{ position: 'absolute', left: pad, right: pad, top: groupsTop, fontSize: 16, color: t.muted, textAlign: 'center' }}>Nothing fetched yet</div>
          )}

          {loadedPages.map((p, i) => {
            const at = groupAt(i)
            const o = fadeIn(frame, p.land, 8)
            return (
              <div key={i} style={{ position: 'absolute', left: at.x, top: at.y, width: groupW, height: groupH, opacity: o, translate: `0 ${(1 - o) * 10}px` }}>
                <div style={{ height: 30, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontFamily: t.mono, fontSize: 16, color: t.muted, whiteSpace: 'nowrap' }}>
                  <span>page {i + 1}</span>
                  {p.next ? <span>next: <span style={{ color: t.accent }}>{p.next}</span></span> : <span style={{ color: t.fg }}>no next</span>}
                </div>
                {p.titles.map(title => (
                  <div key={title} style={{ height: ROW_H, display: 'flex', alignItems: 'center', borderTop: `1px solid ${t.line}`, fontSize: 18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
                ))}
                <div style={{ height: 28, display: 'flex', alignItems: 'center', borderTop: `1px solid ${t.line}`, fontSize: 16, color: t.muted }}>+ {p.count - p.titles.length} more</div>
              </div>
            )
          })}

          {buttonGone > 0 && (
            <div style={{
              position: 'absolute', left: btnX, top: buttonTop, width: BTN_W, height: BTN_H, borderRadius: 999,
              background: t.accent, color: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 600, opacity: buttonGone, scale: String((1 - 0.06 * press) * (0.92 + 0.08 * buttonGone)),
            }}>Load more</div>
          )}
          {frame >= DONE + 3 && (
            <div style={{ position: 'absolute', left: pad, right: pad, top: buttonTop - 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, opacity: fadeIn(frame, DONE + 3, 8), textAlign: 'center' }}>
              <span style={{ fontSize: 18, fontWeight: 600 }}>No request: the walk is over</span>
              <span style={{ fontFamily: t.mono, fontSize: 16, color: t.muted }}>pages.next() → {'{'} done: true {'}'}</span>
            </div>
          )}
        </div>

        {/* The ripple of the latest click */}
        {lastClick !== undefined && frame < lastClick + 14 && (() => {
          const k = CLICKS.indexOf(lastClick)
          const at = target(k)
          const r = interpolate(frame, [lastClick, lastClick + 14], [6, 38], { ...clamp, easing: out })
          return <div style={{ position: 'absolute', left: at.x - 18 - r, top: at.y - 6 - r, width: r * 2, height: r * 2, borderRadius: '50%', border: `2px solid ${t.accent}`, opacity: interpolate(frame, [lastClick, lastClick + 14], [0.8, 0], clamp) }} />
        })()}

        {/* The pointer: an arrow in the theme's colours, its tip at (x, y) */}
        <svg width={30} height={36} viewBox="0 0 30 36" style={{ position: 'absolute', left: pointer.x - 3, top: pointer.y - 2, scale: String(1 - 0.14 * press), transformOrigin: '3px 2px', overflow: 'visible' }}>
          <path d="M3 2 L3 28 L10 21.5 L14.5 32 L19 30 L14.5 19.5 L24 19.5 Z" fill={t.fg} stroke={t.bg} strokeWidth={2} strokeLinejoin="round" />
        </svg>

        {/* The network list: one row per click that sent a request; click 4 sent none */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: netTop, display: 'flex', flexDirection: 'column', gap: 10, fontFamily: t.mono, fontSize: 16 }}>
          <div style={{ height: 16, color: t.muted, fontFamily: t.font, fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Network</div>
          {PAGES.filter(p => frame >= p.send).map(p => {
            const done = frame >= p.land
            const x0 = scale(p.send)
            const x1 = scale(Math.min(frame, p.land))
            return (
              <div key={p.send} style={{ height: ROW, display: 'grid', gridTemplateColumns: '25ch 1fr 4ch', gap: 12, alignItems: 'center', opacity: fadeIn(frame, p.send, 3) }}>
                <span style={{ whiteSpace: 'nowrap' }}>/posts?limit=10<span style={{ color: t.accent }}>{p.cursor}</span></span>
                <span style={{ position: 'relative', height: 10 }}>
                  <span style={{ position: 'absolute', left: `${x0 * 100}%`, width: `${Math.max(0.5, (x1 - x0) * 100)}%`, top: 0, bottom: 0, borderRadius: 4, background: t.accent, opacity: done ? 0.9 : 0.6 }} />
                </span>
                <span style={{ color: done ? t.ok : t.muted, textAlign: 'right' }}>{done ? '200' : '…'}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Frames the preview runs (the slide's preview action is 200). */
export const PAGINATION_FRAMES = 200

export default PaginationPreview
