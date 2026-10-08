// weather.ts on a page: a Today card and a sidebar chip both ask getWeather({ city: 'Tallinn' })
// through cacheMiddleware({ ttl: 20 * 60_000 }). Real time, except one labelled jump of the
// clock. What it shows is cacheMiddleware's real behaviour (src/built-in-middleware.ts,
// src/utils/cache.ts): a successful answer is stored when it arrives; the same call within
// the ttl is answered from the store and sends nothing; a read at or past the ttl deletes the
// entry, and the call goes to the network.
import React from 'react'
import { Easing, interpolate } from 'remotion'
import type { PreviewProps, PreviewTheme } from './types'

const FPS = 30
const END = 210
const START = 9 * 3600 // the clock starts at 09:00:00
const JUMP_AT = 110
const JUMP_FRAMES = 14
const JUMP_S = 20 * 60
const TTL_S = 20 * 60
const TODAY = { ask: 22, land: 40 }
const SIDEBAR_HIT = 60
const AGAIN = { ask: 150, land: 166 }
const REQUESTS = [TODAY, AGAIN]
const TODAY_H = 72

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** The page's clock, in seconds since midnight: real time, plus the one jump. */
const clockAt = (f: number) =>
  START + f / FPS + JUMP_S * interpolate(f, [JUMP_AT, JUMP_AT + JUMP_FRAMES], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) })
const pad = (n: number) => String(Math.floor(n)).padStart(2, '0')
const hms = (s: number) => `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`
const minSec = (s: number) => `${Math.floor(s / 60)}:${pad(s % 60)}`

const Cloud: React.FC<{ size: number; t: PreviewTheme }> = ({ size, t }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={t.fg} strokeWidth={1.7} strokeLinejoin="round">
    <path d="M7.2 18.5h9.6a4 4 0 0 0 .4-7.98 5.6 5.6 0 0 0-10.7 1.3A3.35 3.35 0 0 0 7.2 18.5z" />
  </svg>
)

/** A placeholder bar; it pulses while its widget waits for an answer. */
const Skeleton: React.FC<{ w: number | string; h: number; pulse: boolean; f: number; t: PreviewTheme }> = ({ w, h, pulse, f, t }) => (
  <span style={{ display: 'block', width: w, height: h, borderRadius: 6, background: t.line, opacity: pulse ? 0.55 + 0.45 * Math.sin(f / 3) : 0.6 }} />
)

const Pill: React.FC<{ tone: 'ok' | 'plain'; t: PreviewTheme; children: React.ReactNode }> = ({ tone, t, children }) => (
  <span style={{ alignSelf: 'flex-start', background: tone === 'ok' ? t.okSoft : t.line, color: tone === 'ok' ? t.ok : t.fg, borderRadius: 999, padding: '6px 12px', fontSize: 16, fontWeight: 600 }}>{children}</span>
)

export const CachePreview: React.FC<PreviewProps> = ({ frame, width, height, theme: t }) => {
  const f = frame
  const now = clockAt(f)
  const jumped = f >= JUMP_AT
  const asks = [TODAY.ask, SIDEBAR_HIT, AGAIN.ask].filter(at => f >= at).length
  const requests = REQUESTS.filter(r => f >= r.ask).length

  // The store's one entry: from the first answer until the read that finds it expired,
  // then the second answer's.
  const stored = f >= AGAIN.land ? clockAt(AGAIN.land) : f >= TODAY.land && f < AGAIN.ask ? clockAt(TODAY.land) : null
  const age = stored === null ? 0 : now - stored
  const expired = stored !== null && age >= TTL_S
  const entryState = stored === null ? (f >= AGAIN.ask ? 'removed' : 'empty')
    : expired ? 'expired'
    : f >= SIDEBAR_HIT && f < SIDEBAR_HIT + 40 ? 'hit'
    : f < (f >= AGAIN.land ? AGAIN.land : TODAY.land) + 20 ? 'stored'
    : 'fresh'

  const todayFill = interpolate(f - TODAY.land, [0, 6], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) })
  const sideTemp = f >= AGAIN.land ? 10 : 9
  const sideWaiting = f >= AGAIN.ask && f < AGAIN.land
  const sideFill = f >= AGAIN.land ? interpolate(f - AGAIN.land, [0, 6], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) }) : 1
  const jumpPill = interpolate(f, [JUMP_AT, JUMP_AT + 4], [0, 1], clamp)
  // A landscape panel (the phone layout puts the preview under the editor) sets the two
  // widgets, and the two lists, side by side.
  const wide = width > height

  return (
    <div style={{ width, height, background: t.bg, color: t.fg, borderRadius: t.radius, boxShadow: `0 0 0 1px ${t.line}`, padding: 28, boxSizing: 'border-box', fontFamily: t.font, display: 'flex', flexDirection: 'column', gap: wide ? 16 : 20, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 16, color: t.muted }}>
        <span style={{ fontWeight: 600, color: t.fg, fontSize: 18 }}>{'<Weather />'}</span>
        <span>real time, plus one jump</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, border: `1px solid ${t.line}`, borderRadius: 14, padding: '12px 16px', background: t.field }}>
        <span style={{ fontSize: 16, color: t.muted }}>clock</span>
        <span style={{ fontFamily: t.mono, fontSize: 30, fontVariantNumeric: 'tabular-nums', color: f >= JUMP_AT && f < JUMP_AT + JUMP_FRAMES ? t.accent : t.fg }}>{hms(now)}</span>
        {jumped && (
          <span style={{ marginLeft: 'auto', opacity: jumpPill, border: `1.5px solid ${t.accent}`, color: t.accent, borderRadius: 999, padding: '5px 12px', fontSize: 16, fontWeight: 600 }}>
            jump: +20 min
          </span>
        )}
      </div>

      {/* The page: the Today card and the sidebar chip, each calling getWeather on its own. */}
      <div style={{ flex: '0 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', border: `1px solid ${t.line}`, borderRadius: 16, overflow: 'hidden', background: t.field }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: `1px solid ${t.line}`, background: t.bg }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontSize: 18 }}>
            <span style={{ width: 22, height: 22, borderRadius: 7, background: t.accent }} />Weather
          </span>
          <span style={{ fontSize: 16, color: t.muted }}>
            {asks} {asks === 1 ? 'ask' : 'asks'} · <span style={{ color: t.fg, fontWeight: 600 }}>{requests} {requests === 1 ? 'request' : 'requests'}</span>
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: wide ? 'row' : 'column' }}>
          <div style={{ flex: wide ? '1 1 0' : 'none', padding: 22, display: 'flex', flexDirection: 'column', gap: 12, [wide ? 'borderRight' : 'borderBottom']: `1px solid ${t.line}` }}>
            <span style={{ fontSize: 16, color: t.muted }}>Today in Tallinn</span>
            {f < TODAY.land ? (
              <div style={{ height: TODAY_H, display: 'flex', alignItems: 'center', gap: 16 }}>
                <Skeleton w={130} h={52} pulse={f >= TODAY.ask} f={f} t={t} />
                <Skeleton w={90} h={18} pulse={f >= TODAY.ask} f={f} t={t} />
              </div>
            ) : (
              <div style={{ height: TODAY_H, display: 'flex', alignItems: 'center', gap: 16, opacity: todayFill, translate: `0 ${(1 - todayFill) * 6}px` }}>
                <span style={{ fontSize: 64, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1 }}>9°C</span>
                <Cloud size={50} t={t} />
                <span style={{ fontSize: 18, color: t.muted }}>Cloudy</span>
              </div>
            )}
            <span style={{ fontSize: 16, color: t.muted }}>{f >= TODAY.ask ? `asked ${hms(clockAt(TODAY.ask))}` : 'not asked yet'}</span>
          </div>

          <div style={{ flex: wide ? '1 1 0' : 'none', padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontSize: 16, color: t.muted }}>Sidebar</span>
            <span style={{ alignSelf: 'flex-start', height: 46, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', gap: 10, border: `1px solid ${t.line}`, borderRadius: 999, padding: '0 18px', fontSize: 18 }}>
              {f < SIDEBAR_HIT || sideWaiting ? (
                <Skeleton w={110} h={18} pulse={sideWaiting} f={f} t={t} />
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, opacity: sideFill }}>
                  <Cloud size={24} t={t} />Tallinn <b style={{ fontWeight: 600 }}>{sideTemp}°C</b>
                </span>
              )}
            </span>
            <span style={{ fontSize: 16, color: t.muted }}>
              {f >= AGAIN.ask ? `asked ${hms(clockAt(AGAIN.ask))}` : f >= SIDEBAR_HIT ? `asked ${hms(clockAt(SIDEBAR_HIT))}` : 'not asked yet'}
            </span>
            <div style={{ height: 34, display: 'flex' }}>
              {f >= SIDEBAR_HIT && f < AGAIN.ask && <Pill tone="ok" t={t}>from cache · 0 requests</Pill>}
              {f >= AGAIN.ask && <Pill tone="plain" t={t}>entry expired · a new request</Pill>}
            </div>
          </div>
        </div>
      </div>

      {/* Both lists are sized for their final rows up front, so nothing moves when one arrives. */}
      <div style={{ marginTop: 'auto', flex: 'none', display: 'flex', flexDirection: wide ? 'row' : 'column', gap: wide ? 32 : 20 }}>
        <div style={{ flex: wide ? '1 1 0' : 'none', minWidth: 0, minHeight: 84, display: 'flex', flexDirection: 'column', gap: 10, fontFamily: t.mono, fontSize: 16, lineHeight: '22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: t.font, color: t.muted }}>
            <span style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>Cache</span>
            <span>ttl 20 min</span>
          </div>
          {stored === null ? (
            <span style={{ color: t.muted }}>{entryState === 'removed' ? 'expired entry removed on read' : 'empty'}</span>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 7ch', rowGap: 8, columnGap: 10, alignItems: 'center' }}>
              <span>{"{ city: 'Tallinn' }"}</span>
              <span style={{ textAlign: 'right', color: entryState === 'expired' ? t.err : entryState === 'hit' ? t.ok : t.muted }}>{entryState}</span>
              <span style={{ position: 'relative', height: 8, borderRadius: 4, background: t.line }}>
                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(1, age / TTL_S) * 100}%`, minWidth: 4, borderRadius: 4, background: expired ? t.err : t.accent }} />
              </span>
              <span style={{ textAlign: 'right', color: expired ? t.err : t.muted, fontVariantNumeric: 'tabular-nums' }}>{minSec(age)}</span>
            </div>
          )}
        </div>

        <div style={{ flex: wide ? '1 1 0' : 'none', minWidth: 0, minHeight: 22 + REQUESTS.length * 32, display: 'flex', flexDirection: 'column', gap: 10, fontFamily: t.mono, fontSize: 16, lineHeight: '22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: t.font, color: t.muted }}>
            <span style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>Network</span>
            {jumped && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 2, height: 16, background: t.accent }} />the jump
              </span>
            )}
          </div>
          {REQUESTS.filter(r => f >= r.ask).map(r => {
            const done = f >= r.land
            const x0 = r.ask / END
            const x1 = Math.min(f, r.land) / END
            return (
              <div key={r.ask} style={{ display: 'grid', gridTemplateColumns: '21ch 1fr 3.5ch', gap: 10, alignItems: 'center', opacity: interpolate(f - r.ask, [0, 4], [0.3, 1], clamp) }}>
                <span>/weather?city=Tallinn</span>
                <span style={{ position: 'relative', height: 10 }}>
                  {jumped && <span style={{ position: 'absolute', left: `${(JUMP_AT / END) * 100}%`, width: 2, top: -4, bottom: -4, background: t.accent }} />}
                  <span style={{ position: 'absolute', left: `${x0 * 100}%`, width: `max(4px, ${(x1 - x0) * 100}%)`, top: 0, bottom: 0, borderRadius: 4, background: t.accent, opacity: done ? 0.9 : 0.6 }} />
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

export const CACHE_FRAMES = END

export default CachePreview
