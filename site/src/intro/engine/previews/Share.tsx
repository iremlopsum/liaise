// The share slide's preview: three components on one page each call api.getMe() at
// the same moment. getMe has share: true, so the three calls ride ONE GET /me, and
// when that answer lands every component fills at once (each caller gets its own
// Result). Slowed down 10x so the joining is visible: the request takes 22 frames
// on screen, about 70 ms in real time. Frame-driven only.
import React from 'react'
import { Easing, interpolate, interpolateColors } from 'remotion'
import type { PreviewProps } from './types'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const out = Easing.bezier(0.16, 1, 0.3, 1)
const inOut = Easing.inOut(Easing.cubic)

const USER = { name: 'Ada Lovelace', email: 'ada@example.com', initials: 'AL' }

/** When each component's effect calls api.getMe() (all in the same commit). */
const CALLS = [
  { who: 'Header', at: 8 },
  { who: 'Sidebar', at: 10 },
  { who: 'Avatar', at: 12 },
] as const
/** The chips head for the network list here, one frame apart, and take FLY frames. */
const FLY_START = 24
const FLY = 16
/** The one request is on the list (the chips have converged into it). */
const SENT = 38
/** 200: every component fills at the same moment. */
const ANSWER = 60
/** The network bar's time axis, in frames. */
const AXIS: [number, number] = [28, 68]

/** 1 for a while from `at` on, easing in and out: a highlight that comes and goes. */
const pulse = (frame: number, at: number, len: number) =>
  interpolate(frame, [at, at + 3, at + len], [0, 1, 0], clamp)

export const SharePreview: React.FC<PreviewProps> = ({ frame, width, height, theme: t }) => {
  const P = 28
  const W = width - P * 2
  const H = height - P * 2

  // Bottom up: the network row, its label, the counter; the page takes what is left.
  const rowY = H - 13
  const netLabelTop = H - 26 - 10 - 16
  const statsTop = netLabelTop - 28 - 56
  const pageTop = 46
  const pageH = Math.max(220, Math.min(520, statsTop - 90 - pageTop))

  // The page's three components, in content-box coordinates.
  const pad = 14
  const header = { x: pad, y: pageTop + pad, w: W - pad * 2, h: 64 }
  const bodyY = header.y + header.h + pad
  const bodyH = pageTop + pageH - pad - bodyY
  const colW = (W - pad * 3) / 2
  const sidebar = { x: pad, y: bodyY, w: colW, h: bodyH }
  const avatar = { x: pad * 2 + colW, y: bodyY, w: colW, h: bodyH }
  const boxes = { Header: header, Sidebar: sidebar, Avatar: avatar }
  const disc = Math.max(56, Math.min(96, avatar.h * 0.42)) // the avatar's diameter
  const signedTop = sidebar.h >= 280 ? sidebar.h - 74 : 52 // "Signed in as": at the foot of a tall sidebar

  const fill = interpolate(frame, [ANSWER, ANSWER + 6], [0, 1], { ...clamp, easing: out })
  const flash = pulse(frame, ANSWER, 18)
  const shimmer = 0.55 + 0.25 * (0.5 + 0.5 * Math.sin(frame / 5))
  const skeleton = { background: t.line, borderRadius: 7, opacity: shimmer * (1 - fill) } as const

  const calls = CALLS.filter(c => frame >= c.at).length
  const rowIn = interpolate(frame, [SENT - 4, SENT + 2], [0, 1], clamp)
  const answered = frame >= ANSWER
  const scale = (f: number) => interpolate(f, AXIS, [0, 1], clamp)
  const x0 = scale(SENT)
  const x1 = scale(Math.min(frame, ANSWER))

  // A plain function, not a component: a component declared in render would remount every frame.
  const box = (b: { x: number; y: number; w: number; h: number }, tag: string, children: React.ReactNode) => (
    <div style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: 12, background: t.bg, border: `1px solid ${interpolateColors(flash, [0, 1], [t.line, t.accent])}` }}>
      <span style={{ position: 'absolute', left: 14, top: 12, fontFamily: t.mono, fontSize: 16, color: t.muted }}>{`<${tag} />`}</span>
      {children}
    </div>
  )

  return (
    <div style={{ position: 'relative', width, height, background: t.bg, color: t.fg, borderRadius: t.radius, boxShadow: `0 0 0 1px ${t.line}`, fontFamily: t.font, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: P, top: P, width: W, height: H }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 16, color: t.muted, height: 26 }}>
          <span style={{ fontWeight: 600, color: t.fg, fontSize: 18 }}>Page</span>
          <span>share: true · 10× slower than real</span>
        </div>

        {/* The page */}
        <div style={{ position: 'absolute', left: 0, top: pageTop, width: W, height: pageH, borderRadius: 16, background: t.field, border: `1px solid ${t.line}` }} />
        {box(header, 'Header', (
          <div style={{ position: 'absolute', right: 16, top: 0, bottom: 0, display: 'flex', alignItems: 'center' }}>
            <div style={{ position: 'relative', width: 130, height: 24 }}>
              <div style={{ ...skeleton, position: 'absolute', right: 0, top: 5, width: 130, height: 14 }} />
              <div style={{ position: 'absolute', right: 0, top: 0, fontSize: 18, fontWeight: 600, whiteSpace: 'nowrap', opacity: fill }}>{USER.name}</div>
            </div>
          </div>
        ))}
        {box(sidebar, 'Sidebar', <>
          {/* Static chrome, not data: shown when the sidebar is tall enough to be a sidebar. */}
          {sidebar.h >= 280 && ['Home', 'Projects', 'Settings'].map((item, i) => (
            <div key={item} style={{ position: 'absolute', left: 14, right: 14, top: 50 + i * 36, fontSize: 17, color: i === 0 ? t.fg : t.muted }}>{item}</div>
          ))}
          <div style={{ position: 'absolute', left: 14, right: 14, top: signedTop, fontSize: 16, color: t.muted }}>Signed in as</div>
          <div style={{ position: 'absolute', left: 14, right: 14, top: signedTop + 28, height: 26 }}>
            <div style={{ ...skeleton, position: 'absolute', left: 0, top: 6, width: Math.min(150, sidebar.w - 28), height: 14 }} />
            <div style={{ position: 'absolute', left: 0, top: 0, fontSize: 18, whiteSpace: 'nowrap', opacity: fill }}>{USER.email}</div>
          </div>
        </>)}
        {box(avatar, 'Avatar', (
          <div style={{ position: 'absolute', left: (avatar.w - disc) / 2, top: Math.max(44, avatar.h * 0.42 - disc / 2), width: disc, height: disc }}>
            <div style={{ ...skeleton, position: 'absolute', inset: 0, borderRadius: '50%' }} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: t.accent, color: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: disc * 0.36, fontWeight: 700, opacity: fill, scale: String(0.9 + 0.1 * fill) }}>{USER.initials}</div>
          </div>
        ))}

        {/* The counter */}
        {/* Right-aligned, out of the chips' way: they converge on the row's left end. */}
        <div style={{ position: 'absolute', right: 0, top: statsTop, height: 56, display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 20, color: t.muted, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 44, fontWeight: 700, color: t.fg, fontVariantNumeric: 'tabular-nums', opacity: calls ? 1 : 0.35 }}>{calls}</span>
          <span>{calls === 1 ? 'call' : 'calls'}</span>
          <span style={{ opacity: rowIn, display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span>·</span>
            <span style={{ fontSize: 44, fontWeight: 700, color: t.accent }}>1</span>
            <span>request</span>
          </span>
        </div>

        {/* The network list: one row, the one request the three calls share */}
        <div style={{ position: 'absolute', left: 0, top: netLabelTop, color: t.muted, fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Network</div>
        <div style={{ position: 'absolute', left: -8, right: -8, top: rowY - 17, height: 34, borderRadius: 8, background: t.accent, opacity: 0.2 * pulse(frame, SENT, 20) }} />
        <div style={{ position: 'absolute', left: 0, right: 0, top: rowY - 13, height: 26, display: 'grid', gridTemplateColumns: '10.5ch 1fr 9ch', gap: 12, alignItems: 'center', fontFamily: t.mono, fontSize: 16, opacity: rowIn }}>
          <span>GET /me</span>
          <span style={{ position: 'relative', height: 10 }}>
            <span style={{ position: 'absolute', left: `${x0 * 100}%`, width: `${Math.max(0.5, (x1 - x0) * 100)}%`, top: 0, bottom: 0, borderRadius: 4, background: t.accent, opacity: answered ? 0.9 : 0.6 }} />
          </span>
          <span style={{ color: answered ? t.ok : t.muted, textAlign: 'right' }}>{answered ? '200' : '…'}</span>
        </div>

        {/* The three calls: each appears on its component, then they converge into the row */}
        {CALLS.map((c, i) => {
          if (frame < c.at) return null
          const b = boxes[c.who]
          const sx = b.x + b.w / 2
          const sy = c.who === 'Header' ? b.y + b.h / 2 : b.y + b.h * 0.66
          const tx = 44
          const ty = rowY
          const appear = interpolate(frame, [c.at, c.at + 7], [0, 1], { ...clamp, easing: out })
          const p = interpolate(frame, [FLY_START + i, FLY_START + i + FLY], [0, 1], { ...clamp, easing: inOut })
          const gone = interpolate(p, [0.72, 1], [1, 0], clamp)
          if (gone <= 0) return null
          return (
            <div key={c.who} style={{
              position: 'absolute', left: sx + (tx - sx) * p, top: sy + (ty - sy) * p + (1 - appear) * 10,
              transform: `translate(-50%, -50%) scale(${(0.85 + 0.15 * appear) * (1 - 0.25 * p)})`,
              opacity: appear * gone, whiteSpace: 'nowrap',
              background: t.bg, border: `1.5px solid ${t.accent}`, borderRadius: 999, padding: '6px 14px',
              display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 16,
            }}>
              <span style={{ fontWeight: 600 }}>{c.who}</span>
              <span style={{ color: t.muted }}>·</span>
              <span style={{ fontFamily: t.mono, color: t.accent }}>api.getMe()</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Frames the preview runs (the slide's preview action is 150). */
export const SHARE_FRAMES = 150

export default SharePreview
