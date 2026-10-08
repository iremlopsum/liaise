// The middleware slide's two previews. Frame-driven only.
//
// index 0: middleware: [retryMiddleware(3), logMiddleware]. Retry is the outer layer
// and log the inner one, so the log prints every attempt: the 503, then the retry's
// 200. The lines are liaise's real log format (src/utils/log.ts). Slowed down 8x:
// the attempts take 84 ms and 61 ms, and the wait between them is one jittered
// backoff under the 250 ms default base (150 ms here).
//
// index 1: the custom auth middleware. It sets the authorization header before
// fetch, and after the Result comes back it calls signOut() when the status is 401.
import React from 'react'
import { Easing, interpolate, interpolateColors } from 'remotion'
import type { PreviewProps } from './types'

type Theme = PreviewProps['theme']

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const out = Easing.bezier(0.16, 1, 0.3, 1)

const fadeIn = (frame: number, at: number, len = 5) => interpolate(frame, [at, at + len], [0, 1], { ...clamp, easing: out })
/** 0 → 1 over [from, to], with short ramps at both ends. */
const during = (frame: number, from: number, to: number, ramp = 3) =>
  interpolate(frame, [from, from + ramp, to, to + ramp], [0, 1, 1, 0], clamp)

const URL_BASE = 'https://api.example.com'

type Row = { key: string; path: string; start: number; land: number; status: number }

/** The NETWORK list, as on the search preview: path, a bar on a shared time axis, outcome. */
const Network: React.FC<{ t: Theme; frame: number; rows: Row[]; axis: [number, number]; selected?: string }> = ({ t, frame, rows, axis, selected }) => {
  const scale = (f: number) => interpolate(f, axis, [0, 1], clamp)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontFamily: t.mono, fontSize: 16 }}>
      <div style={{ color: t.muted, fontFamily: t.font, fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Network</div>
      {rows.filter(r => frame >= r.start).map(r => {
        const done = frame >= r.land
        const x0 = scale(r.start)
        const x1 = scale(Math.min(frame, r.land))
        const bad = r.status >= 400
        return (
          <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '10.5ch 1fr 9ch', gap: 12, alignItems: 'center', opacity: fadeIn(frame, r.start, 3), margin: '0 -8px', padding: '3px 8px', borderRadius: 8, boxShadow: selected === r.key ? `0 0 0 1px ${t.line}` : 'none' }}>
            <span>{r.path}</span>
            <span style={{ position: 'relative', height: 10 }}>
              <span style={{ position: 'absolute', left: `${x0 * 100}%`, width: `${Math.max(0.5, (x1 - x0) * 100)}%`, top: 0, bottom: 0, borderRadius: 4, background: done && bad ? t.err : t.accent, opacity: done ? 0.9 : 0.6 }} />
            </span>
            <span style={{ color: done ? (bad ? t.err : t.ok) : t.muted, textAlign: 'right' }}>{done ? String(r.status) : '…'}</span>
          </div>
        )
      })}
    </div>
  )
}

const Frame: React.FC<{ t: Theme; width: number; height: number; title: React.ReactNode; note: string; children: React.ReactNode }> = ({ t, width, height, title, note, children }) => (
  <div style={{ width, height, background: t.bg, color: t.fg, borderRadius: t.radius, boxShadow: `0 0 0 1px ${t.line}`, padding: 28, fontFamily: t.font, display: 'flex', flexDirection: 'column', gap: 20, overflow: 'hidden', boxSizing: 'border-box' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 16, color: t.muted }}>
      <span style={{ fontWeight: 600, color: t.fg, fontSize: 18 }}>{title}</span>
      <span style={{ whiteSpace: 'nowrap' }}>{note}</span>
    </div>
    {children}
  </div>
)

// ---------------------------------------------------------------------------
// index 0: retry outside, log inside
// ---------------------------------------------------------------------------

const SLOW = 8
const MS = (ms: number) => Math.round((ms / 1000) * 30 * SLOW) // ms -> frames at 30 fps, slowed
const A1 = { start: 6, end: 6 + MS(84) } // the first attempt: 503
const A2 = { start: A1.end + MS(150), end: A1.end + MS(150) + MS(61) } // the retry: 200

type LogLine =
  | { at: number; kind: 'start' }
  | { at: number; kind: 'end'; status: string; ok: boolean; ms: number }
  | { at: number; kind: 'note' }

const LOG: LogLine[] = [
  { at: A1.start, kind: 'start' },
  { at: A1.end, kind: 'end', status: 'ERROR 503', ok: false, ms: 84 },
  { at: A1.end + 2, kind: 'note' },
  { at: A2.start, kind: 'start' },
  { at: A2.end, kind: 'end', status: 'OK', ok: true, ms: 61 },
]

/** One middleware layer of the onion: a box with its name and what it is doing now. */
const Layer: React.FC<{ t: Theme; name: string; active: number; status: React.ReactNode; children?: React.ReactNode }> = ({ t, name, active, status, children }) => (
  <div style={{ border: `1.5px solid ${interpolateColors(active, [0, 1], [t.line, t.accent])}`, borderRadius: 12, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, whiteSpace: 'nowrap' }}>
      <span style={{ fontFamily: t.mono, fontSize: 16 }}>{name}</span>
      <span style={{ fontSize: 16, color: t.muted }}>{status}</span>
    </div>
    {children}
  </div>
)

const LogPreview: React.FC<PreviewProps> = ({ frame, width, height, theme: t }) => {
  const wide = width >= 760 // the phone layout's panel is wide and short
  const inFlight = during(frame, A1.start, A1.end) + during(frame, A2.start, A2.end)
  const printing = [A1.start, A1.end, A2.start, A2.end].reduce((sum, at) => sum + during(frame, at, at + 6, 2), 0)
  const waiting = during(frame, A1.end, A2.start)
  const done = frame >= A2.end

  const retryStatus = frame < A1.end ? 'attempt 1'
    : frame < A2.start ? <span style={{ color: t.accent }}>waiting…</span>
    : frame < A2.end ? 'retry 1 of 3' : 'done after 1 retry'
  const fetchStatus = frame < A1.start ? ''
    : frame < A1.end ? '…'
    : frame < A2.start ? <span style={{ color: t.err }}>503</span>
    : frame < A2.end ? '…' : <span style={{ color: t.ok }}>200</span>
  const lines = LOG.filter(l => frame >= l.at).length
  const prints = LOG.filter(l => l.kind !== 'note' && frame >= l.at).length

  const onion = (
    <div style={{ flex: wide ? '0 0 40%' : 'none' }}>
      <Layer t={t} name="retryMiddleware(3)" active={waiting} status={retryStatus}>
        <Layer t={t} name="logMiddleware" active={Math.min(1, printing)} status={`${prints} ${prints === 1 ? 'line' : 'lines'}`}>
          <Layer t={t} name="fetch" active={inFlight} status={fetchStatus} />
        </Layer>
      </Layer>
    </div>
  )

  const prefix = <span style={{ color: t.muted }}>[liaise]</span>
  const console_ = (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, background: t.field, border: `1px solid ${t.line}`, borderRadius: 14, padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 6, fontFamily: t.mono, fontSize: 16, lineHeight: 1.5 }}>
      <div style={{ fontFamily: t.font, color: t.muted, paddingBottom: 4, borderBottom: `1px solid ${t.line}`, marginBottom: 2 }}>Console</div>
      {LOG.slice(0, lines).map((l, i) => {
        const o = fadeIn(frame, l.at, 4)
        if (l.kind === 'note') {
          const p = interpolate(frame, [A1.end, A2.start], [0, 1], clamp)
          return (
            <div key={i} style={{ opacity: o, fontFamily: t.font, color: t.accent, borderLeft: `2px solid ${t.accent}`, padding: '2px 0 4px 12px', margin: '4px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span>retryMiddleware waits, then tries again</span>
              <span style={{ position: 'relative', height: 4, borderRadius: 2, background: t.line, width: '70%' }}>
                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${p * 100}%`, borderRadius: 2, background: t.accent }} />
              </span>
            </div>
          )
        }
        // A hanging indent: a wrapped line continues under its own text, as a console does.
        return (
          <div key={i} style={{ opacity: o, overflowWrap: 'anywhere', paddingLeft: '2ch', textIndent: '-2ch' }}>
            {prefix}{' '}
            {l.kind === 'start'
              ? <>→ GET getUser {URL_BASE}/users/42</>
              : <>← getUser <span style={{ color: l.ok ? t.ok : t.err }}>{l.status}</span> ({l.ms}ms)</>}
          </div>
        )
      })}
    </div>
  )

  return (
    <Frame t={t} width={width} height={height} title={<span style={{ fontFamily: t.mono, fontWeight: 500, fontSize: 17 }}>api.getUser({'{'} id: '42' {'}'})</span>} note={`${SLOW}× slower than real`}>
      {/* The console takes the height that is left, like a console window. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: wide ? 'row' : 'column', gap: wide ? 16 : 20, alignItems: wide ? 'flex-start' : 'stretch' }}>
        {onion}
        {console_}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, color: t.muted }}>Result</span>
        <span style={{ background: done ? t.okSoft : t.field, color: done ? t.ok : t.muted, borderRadius: 999, padding: '6px 14px', fontSize: 17, fontWeight: 600, border: done ? 'none' : `1px solid ${t.line}` }}>
          {done ? 'data: Ada Lovelace' : 'pending…'}
        </span>
        <span style={{ fontSize: 16, color: t.muted, opacity: fadeIn(frame, A2.end + 4, 8) }}>1 call · 2 requests</span>
      </div>
      <div>
        <Network t={t} frame={frame} axis={[0, A2.end + 10]} rows={[
          { key: 'a1', path: '/users/42', start: A1.start, land: A1.end, status: 503 },
          { key: 'a2', path: '/users/42', start: A2.start, land: A2.end, status: 200 },
        ]} />
      </div>
    </Frame>
  )
}

// ---------------------------------------------------------------------------
// index 1: the auth middleware, before fetch and after the Result
// ---------------------------------------------------------------------------

type Call = { key: string; path: string; show: number; header: number; send: number; land: number; status: number; statusText: string }
const CALLS: Call[] = [
  { key: 'user', path: '/users/42', show: 2, header: 12, send: 22, land: 40, status: 200, statusText: 'OK' },
  { key: 'me', path: '/me', show: 60, header: 70, send: 80, land: 98, status: 401, statusText: 'Unauthorized' },
]
const SWITCH = 58 // the inspector moves on to the second call
const CHECK_AFTER = 4 // frames after the Result that auth's check shows
const TOAST = CALLS[1].land + 14

const AuthPreview: React.FC<PreviewProps> = ({ frame, width, height, theme: t }) => {
  const wide = width >= 760 // the phone layout's panel: request and response side by side
  const c = frame < SWITCH ? CALLS[0] : CALLS[1]
  // The inspector's content fades in, out at the switch, and in again with the second call.
  const swap = interpolate(frame, [0, 3, SWITCH - 4, SWITCH - 1, SWITCH, CALLS[1].show + 3], [0, 1, 1, 0, 0, 1], clamp)
  const step = frame < c.send ? 0 : frame < c.land ? 1 : 2
  const stepOn = (i: number) => (frame >= c.show + 2 && step === i ? 1 : 0)
  const hasHeader = frame >= c.header
  const headerIn = fadeIn(frame, c.header, 6)
  const landed = frame >= c.land
  const checked = frame >= c.land + CHECK_AFTER
  const is401 = c.status === 401
  const toast = interpolate(frame, [TOAST, TOAST + 8], [0, 1], { ...clamp, easing: out })

  const label = (text: string) => <div style={{ fontSize: 16, color: t.muted, marginBottom: 8 }}>{text}</div>
  const pill = (text: string, on: number) => (
    <span style={{ border: `1.5px solid ${interpolateColors(on, [0, 1], [t.line, t.accent])}`, color: on ? t.fg : t.muted, borderRadius: 999, padding: '4px 12px', fontFamily: t.mono, fontSize: 16, whiteSpace: 'nowrap' }}>{text}</span>
  )

  return (
    <Frame t={t} width={width} height={height} title="Request inspector" note="slowed down">
      {/* The inspector takes the height that is left; the app's toast shows at its foot. */}
      <div style={{ position: 'relative', background: t.field, border: `1px solid ${t.line}`, borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 18, flex: 1, minHeight: 0 }}>
        {/* Where the call is: auth runs before fetch and again after the Result. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', color: t.muted }}>
          {pill('auth', stepOn(0))}<span>→</span>{pill('fetch', stepOn(1))}<span>→</span>{pill('auth', stepOn(2))}
        </div>

        <div style={{ opacity: swap, display: 'grid', gridTemplateColumns: wide ? '1fr 1fr' : '1fr', columnGap: 24, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontFamily: t.mono, fontSize: 16, overflowWrap: 'anywhere' }}>
            <span style={{ color: t.accent, fontWeight: 600 }}>GET</span> {URL_BASE}{c.path}
          </div>

          <div>
            {label('Request headers')}
            {!hasHeader && <div style={{ fontFamily: t.mono, fontSize: 16, color: t.muted }}>(none set)</div>}
            {hasHeader && (
              <div style={{ position: 'relative', border: `1.5px solid ${t.accent}`, borderRadius: 10, padding: '10px 12px', opacity: headerIn, translate: `${(1 - headerIn) * -12}px 0`, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ position: 'absolute', inset: 0, borderRadius: 9, background: t.accent, opacity: 0.08 + 0.18 * interpolate(frame, [c.header, c.header + 4, c.header + 24], [0, 1, 0], clamp) }} />
                <span style={{ position: 'relative', fontFamily: t.mono, fontSize: 16, overflowWrap: 'anywhere' }}>authorization: Bearer eyJhbGciOi…</span>
                <span style={{ position: 'relative', alignSelf: 'flex-start', color: t.accent, fontSize: 16, fontWeight: 600 }}>added by auth</span>
              </div>
            )}
          </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: wide ? 0 : 18 }}>
          <div>
            {label('Response')}
            <div style={{ fontFamily: t.mono, fontSize: 18, color: landed ? (is401 ? t.err : t.ok) : t.muted }}>
              {landed ? `${c.status} ${c.statusText}` : frame >= c.send ? 'waiting…' : '—'}
            </div>
          </div>

          <div style={{ opacity: fadeIn(frame, c.land + CHECK_AFTER, 5) }}>
            {label('auth, after the Result')}
            {checked && (
              <div style={{ fontFamily: t.mono, fontSize: 16, display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span>result.error?.status === 401</span>
                <span style={{ color: is401 ? t.err : t.muted, fontWeight: 600 }}>{is401 ? 'true' : 'false'}</span>
              </div>
            )}
          </div>
          </div>
        </div>

        {frame >= TOAST && (
          <div style={{ position: 'absolute', left: 18, bottom: 18, opacity: toast, translate: `0 ${(1 - toast) * 14}px`, background: t.errSoft, color: t.err, borderRadius: 12, padding: '10px 16px', fontSize: 17, fontWeight: 600, border: `1px solid ${t.err}` }}>
            <span style={{ fontFamily: t.mono }}>signOut()</span> ran
          </div>
        )}
      </div>

      <div>
        <Network t={t} frame={frame} axis={[0, CALLS[1].land + 10]} selected={c.key} rows={CALLS.map(r => ({ key: r.key, path: r.path, start: r.send, land: r.land, status: r.status }))} />
      </div>
    </Frame>
  )
}

/** The middleware slide's preview: index 0 is the built-ins, index 1 the auth middleware. */
export const MiddlewarePreview: React.FC<PreviewProps> = props =>
  props.index <= 0 ? <LogPreview {...props} /> : <AuthPreview {...props} />

/** Frames each preview action runs, by index. */
export const MIDDLEWARE_FRAMES = [120, 150]

export default MiddlewarePreview
