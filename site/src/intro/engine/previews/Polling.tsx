// The bell from Bell.tsx: one page with two <Bell />s (the header's and the mobile nav's),
// which share one poll of GET /notifications/unread, every: 10_000. Time-lapse: 10 s of
// page time per 50 frames. What it shows is poll's real behaviour (src/poll.ts): it asks
// at once, then `every` after each answer; with the default inBackground: false a hidden
// tab clears the timer (nothing is sent), and the tab coming back asks at once.
import React from 'react'
import { Easing, interpolate, spring } from 'remotion'
import type { PreviewProps, PreviewTheme } from './types'

const FPS = 30
/** The preview runs 210 frames, then the slide holds 45 more before it stops: the poll keeps going. */
const END = 255
/** Time-lapse: frames per second of page time (10 s per 50 frames). */
const PER_SECOND = 5
const EVERY = 10 * PER_SECOND
/** How long each request is in flight: 0.4 s of page time. */
const LATENCY = 2
const HIDE = 130
const SHOW = 175
/** The server's answers, in order: { unread: n }. */
const UNREAD = [0, 2, 3, 4, 4]

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

type Ask = { start: number; land: number; unread: number }

/** Every request the shared poll sends: at once, then EVERY after each answer, none while hidden. */
const ASKS: Ask[] = (() => {
  const out: Ask[] = []
  let at = 0
  while (at < END && out.length < UNREAD.length) {
    out.push({ start: at, land: at + LATENCY, unread: UNREAD[out.length] })
    let next = at + LATENCY + EVERY
    // Hidden: the timer is cleared, so nothing is sent; visible again: it asks at once.
    if (next >= HIDE && next < SHOW) next = SHOW
    at = next
  }
  return out
})()

const clock = (f: number) => {
  const s = Math.floor(f / PER_SECOND)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const BellIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3.5a5.5 5.5 0 0 0-5.5 5.5v3.6L4.8 15.6c-.3.6.1 1.4.8 1.4h12.8c.7 0 1.1-.8.8-1.4l-1.7-3V9A5.5 5.5 0 0 0 12 3.5z" />
    <path d="M9.8 19.5a2.3 2.3 0 0 0 4.4 0" />
  </svg>
)

/** One <Bell />: the icon, and the badge only when unread > 0 (as Bell.tsx renders it). */
const Bell: React.FC<{ unread: number; scale: number; size: number; t: PreviewTheme }> = ({ unread, scale, size, t }) => (
  <span style={{ position: 'relative', display: 'inline-flex', width: size, height: size }}>
    <BellIcon size={size} color={t.fg} />
    {unread > 0 && (
      <span style={{
        position: 'absolute', top: -9, right: -12, minWidth: 24, height: 24, padding: '0 6px', boxSizing: 'border-box',
        borderRadius: 12, background: t.accent, color: t.bg, fontSize: 16, fontWeight: 700, lineHeight: '24px',
        textAlign: 'center', scale: String(scale), fontFamily: t.font,
      }}>{unread}</span>
    )}
  </span>
)

const Icon: React.FC<{ kind: 'home' | 'search' | 'user'; t: PreviewTheme }> = ({ kind, t }) => (
  <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={t.muted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {kind === 'home' && <path d="M4 11 12 4l8 7v9h-5.5v-6h-5v6H4z" />}
    {kind === 'search' && <><circle cx={11} cy={11} r={6} /><path d="m15.5 15.5 4 4" /></>}
    {kind === 'user' && <><circle cx={12} cy={9} r={4} /><path d="M5 20a7 7 0 0 1 14 0" /></>}
  </svg>
)

export const PollingPreview: React.FC<PreviewProps> = ({ frame, width, height, theme: t }) => {
  const f = frame
  const landed = ASKS.filter(a => f >= a.land)
  const last = landed.length ? landed[landed.length - 1] : null
  const unread = last?.unread ?? 0
  const inFlight = ASKS.find(a => f >= a.start && f < a.land) ?? null
  const hidden = f >= HIDE && f < SHOW
  const dim = interpolate(f, [HIDE, HIDE + 6, SHOW, SHOW + 6], [0, 1, 1, 0], clamp)

  // Both badges change on the same frame: one answer, delivered to both bells.
  let badgeScale = 1
  if (last && last.unread > 0) {
    const before = landed.length >= 2 ? landed[landed.length - 2].unread : 0
    const s = spring({ frame: f - last.land, fps: FPS, config: { damping: 9, stiffness: 220, mass: 0.6 } })
    badgeScale = before === 0 ? s : before === last.unread ? 1 : 1 + 0.45 * (1 - s)
  }

  const status = inFlight ? 'asking…'
    : hidden ? 'paused: nothing is sent'
    : last ? `next ask in ${Math.max(1, Math.ceil((last.land + EVERY - f) / PER_SECOND))} s`
    : ''
  const back = f >= SHOW
  const backPill = interpolate(f, [SHOW, SHOW + 5], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) })
  const seconds = f / PER_SECOND
  const angle = (seconds / 60) * Math.PI * 2

  return (
    <div style={{ width, height, background: t.bg, color: t.fg, borderRadius: t.radius, boxShadow: `0 0 0 1px ${t.line}`, padding: 28, boxSizing: 'border-box', fontFamily: t.font, display: 'flex', flexDirection: 'column', gap: 20, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 16, color: t.muted }}>
        <span style={{ fontWeight: 600, color: t.fg, fontSize: 18 }}>{'<Bell />'}</span>
        <span>time-lapse: 10 s per tick</span>
      </div>

      {/* The browser window: one page, two bells. */}
      <div style={{ position: 'relative', flex: '1 1 0', maxHeight: 540, minHeight: 0, display: 'flex', flexDirection: 'column', border: `1px solid ${t.line}`, borderRadius: 16, overflow: 'hidden', background: t.field }}>
        <div style={{ display: 'flex', gap: 4, padding: '8px 10px 0', background: t.bg, borderBottom: `1px solid ${t.line}` }}>
          {['Inbox', 'Docs'].map((name, i) => {
            const active = (i === 1) === hidden
            return (
              <span key={name} style={{ padding: '6px 16px', fontSize: 16, borderRadius: '10px 10px 0 0', background: active ? t.field : 'transparent', color: active ? t.fg : t.muted, border: `1px solid ${active ? t.line : 'transparent'}`, borderBottom: 'none' }}>{name}</span>
            )
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: `1px solid ${t.line}` }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontSize: 18 }}>
            <span style={{ width: 22, height: 22, borderRadius: 7, background: t.accent }} />Inbox
          </span>
          <Bell unread={unread} scale={badgeScale} size={28} t={t} />
        </div>
        <div style={{ flex: '1 1 0', minHeight: 0, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>
          <span style={{ width: '45%', height: 16, borderRadius: 6, background: t.line }} />
          {[0.8, 0.65, 0.72, 0.58].map((w, i) => (
            <div key={i} style={{ border: `1px solid ${t.line}`, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ width: `${w * 100}%`, height: 12, borderRadius: 5, background: t.line }} />
              <span style={{ width: `${w * 60}%`, height: 12, borderRadius: 5, background: t.line, opacity: 0.6 }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '14px 10px', borderTop: `1px solid ${t.line}` }}>
          <Icon kind="home" t={t} />
          <Icon kind="search" t={t} />
          <Bell unread={unread} scale={badgeScale} size={26} t={t} />
          <Icon kind="user" t={t} />
        </div>
        {dim > 0 && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: 45, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', inset: 0, background: t.bg, opacity: 0.78 * dim }} />
            {hidden && (
              <span style={{ position: 'relative', opacity: dim, background: t.field, border: `1px solid ${t.line}`, borderRadius: 999, padding: '10px 18px', fontSize: 18, fontWeight: 600 }}>
                tab hidden: paused
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ background: t.okSoft, color: t.ok, borderRadius: 999, padding: '6px 12px', fontSize: 16, fontWeight: 600 }}>2 bells · 1 poll</span>
        <span style={{ fontFamily: t.mono, fontSize: 16, color: last ? t.fg : t.muted }}>{last ? `{ unread: ${last.unread} }` : '…'}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <svg width={44} height={44} viewBox="0 0 44 44">
          <circle cx={22} cy={22} r={19} fill="none" stroke={t.line} strokeWidth={2} />
          {[0, 1, 2, 3, 4, 5].map(i => {
            const a = (i / 6) * Math.PI * 2
            return <line key={i} x1={22 + Math.sin(a) * 15} y1={22 - Math.cos(a) * 15} x2={22 + Math.sin(a) * 18} y2={22 - Math.cos(a) * 18} stroke={t.muted} strokeWidth={2} />
          })}
          <line x1={22} y1={22} x2={22 + Math.sin(angle) * 14} y2={22 - Math.cos(angle) * 14} stroke={t.fg} strokeWidth={2.5} strokeLinecap="round" />
        </svg>
        <span style={{ fontFamily: t.mono, fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>{clock(f)}</span>
        <span style={{ marginLeft: 'auto', fontSize: 16, color: hidden ? t.err : t.muted }}>
          {back && backPill > 0 && f < SHOW + 30
            ? <span style={{ opacity: backPill, background: t.okSoft, color: t.ok, borderRadius: 999, padding: '6px 12px', fontWeight: 600 }}>visible again: asks at once</span>
            : status}
        </span>
      </div>

      {/* Sized for all four rows up front, so nothing above it moves when a row arrives. */}
      <div style={{ marginTop: 'auto', flex: 'none', minHeight: 22 + ASKS.length * 32, display: 'flex', flexDirection: 'column', gap: 10, fontFamily: t.mono, fontSize: 16, lineHeight: '22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: t.font, fontSize: 16, color: t.muted }}>
          <span style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>Network</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: t.line }} />tab hidden
          </span>
        </div>
        {ASKS.filter(a => f >= a.start).map(a => {
          const done = f >= a.land
          const x0 = a.start / END
          const x1 = Math.min(f, a.land) / END
          return (
            <div key={a.start} style={{ display: 'grid', gridTemplateColumns: '4.5ch 21ch 1fr 3.5ch', gap: 10, alignItems: 'center', opacity: interpolate(f - a.start, [0, 4], [0.3, 1], clamp) }}>
              <span style={{ color: t.muted }}>{clock(a.start)}</span>
              <span>/notifications/unread</span>
              <span style={{ position: 'relative', height: 10 }}>
                {f >= HIDE && (
                  <span style={{ position: 'absolute', left: `${(HIDE / END) * 100}%`, width: `${((Math.min(f, SHOW) - HIDE) / END) * 100}%`, top: -3, bottom: -3, background: t.line, borderRadius: 2 }} />
                )}
                <span style={{ position: 'absolute', left: `${x0 * 100}%`, width: `max(6px, ${(x1 - x0) * 100}%)`, top: 0, bottom: 0, borderRadius: 4, background: t.accent, opacity: done ? 0.9 : 0.6 }} />
              </span>
              <span style={{ color: done ? t.ok : t.muted, textAlign: 'right' }}>{done ? '200' : '…'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export const POLLING_FRAMES = 210

export default PollingPreview
