// The search box from Search.tsx, running against the demo server, slowed down 4x so
// the race is visible. Timings are the demo server's (a: 700 ms, ad: 500 ms, ada:
// 300 ms, keystrokes 110 ms apart), the same ones the earlier prototypes ran live:
// plain fetch ends on the 'a' answer; with dedupe the 'a' and 'ad' calls are cancelled.
import React from 'react'
import { Easing, interpolate } from 'remotion'

const SLOW = 4
const MS = (ms: number) => Math.round((ms / 1000) * 30 * SLOW) // ms -> frames at 30 fps, slowed

const PEOPLE = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Katherine Johnson', 'Margaret Hamilton', 'Radia Perlman']
const RESULTS: Record<string, string[]> = {
  a: PEOPLE,
  ad: ['Ada Lovelace', 'Radia Perlman'],
  ada: ['Ada Lovelace'],
}

export type Call = { q: string; start: number; land: number; cancelledAt: number | null }

/** The three requests of typing "ada", for plain fetch or with dedupe. */
export function calls(mode: 'plain' | 'dedupe'): Call[] {
  const keys = [{ q: 'a', ms: 700 }, { q: 'ad', ms: 500 }, { q: 'ada', ms: 300 }]
  return keys.map((k, i) => {
    const start = MS(110 * i)
    const next = i < keys.length - 1 ? MS(110 * (i + 1)) : null
    return { q: k.q, start, land: start + MS(k.ms), cancelledAt: mode === 'dedupe' ? next : null }
  })
}

export type PreviewTheme = {
  font: string; mono: string; bg: string; fg: string; muted: string; line: string; field: string
  accent: string; ok: string; err: string; okSoft: string; errSoft: string; radius: number
}

export const SearchPreview: React.FC<{ mode: 'plain' | 'dedupe'; frame: number; width: number; height: number; theme: PreviewTheme }> = ({ mode, frame, width, height, theme: t }) => {
  const list = calls(mode)
  const typed = list.filter(c => frame >= c.start).map(c => c.q).pop() ?? ''
  // What is on screen: the latest answer to land (plain fetch renders every answer).
  const landed = list.filter(c => c.cancelledAt === null || c.cancelledAt > c.land).filter(c => frame >= c.land).sort((a, b) => a.land - b.land)
  const shown = landed.length ? RESULTS[landed[landed.length - 1].q] : []
  const lastQ = landed.length ? landed[landed.length - 1].q : null
  const stale = lastQ !== null && lastQ !== 'ada' && frame >= Math.max(...list.map(c => c.cancelledAt ?? c.land))
  const end = Math.max(...list.map(c => c.land)) + 6
  const scale = (f: number) => interpolate(f, [0, end], [0, 1], { extrapolateRight: 'clamp' })

  return (
    <div style={{ width, height, background: t.bg, color: t.fg, borderRadius: t.radius, boxShadow: `0 0 0 1px ${t.line}`, padding: 28, fontFamily: t.font, display: 'flex', flexDirection: 'column', gap: 20, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 16, color: t.muted }}>
        <span style={{ fontWeight: 600, color: t.fg, fontSize: 18 }}>{'<Search />'}</span>
        <span>{mode === 'plain' ? 'without dedupe' : 'dedupe: true'} · 4× slower than real</span>
      </div>
      <div style={{ border: `1.5px solid ${t.accent}`, background: t.field, borderRadius: 12, padding: '14px 16px', fontSize: 22 }}>
        {typed}<span style={{ display: 'inline-block', width: 2, height: 24, background: t.accent, marginLeft: 2, verticalAlign: '-4px', opacity: Math.floor(frame / 15) % 2 ? 0 : 1 }} />
      </div>
      <div style={{ minHeight: 190, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shown.map((name, i) => (
          <div key={name} style={{ fontSize: 20, padding: '6px 2px', borderBottom: `1px solid ${t.line}`, opacity: interpolate(frame - (landed[landed.length - 1]?.land ?? 0), [0, 6], [0.2, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) }), translate: `0 ${i * 0}px` }}>{name}</div>
        ))}
        {stale && (
          <div style={{ marginTop: 8, alignSelf: 'flex-start', background: t.errSoft, color: t.err, borderRadius: 999, padding: '6px 12px', fontSize: 16, fontWeight: 600 }}>
            Shows results for “a”, but the box says “ada”
          </div>
        )}
        {!stale && lastQ === 'ada' && frame >= end - 6 && (
          <div style={{ marginTop: 8, alignSelf: 'flex-start', background: t.okSoft, color: t.ok, borderRadius: 999, padding: '6px 12px', fontSize: 16, fontWeight: 600 }}>
            Matches what was typed
          </div>
        )}
      </div>
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10, fontFamily: t.mono, fontSize: 16 }}>
        <div style={{ color: t.muted, fontFamily: t.font, fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Network</div>
        {list.filter(c => frame >= c.start).map(c => {
          const until = c.cancelledAt !== null && c.cancelledAt < c.land ? c.cancelledAt : c.land
          const done = frame >= until
          const cancelled = c.cancelledAt !== null && c.cancelledAt < c.land && frame >= c.cancelledAt
          const x0 = scale(c.start), x1 = scale(Math.min(frame, until))
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

export const PREVIEW_FRAMES = Math.max(...calls('plain').map(c => c.land)) + 6
