// Step 10, Your turn: a real editor (the site's Monaco, with liaise's own types), the reader's code
// run for real against the site's fake API, and five checks that tick as the code runs. Ported
// from the prototype (docs/prototypes/intro-keynote-2026-10-08/src/playground.tsx) onto the site's
// editor (playground/editor.ts, imported here, so Monaco loads at step 10 and never before) and
// runner (through harness.ts). Below 768 px no editor loads, as on /playground/.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MountedEditor } from '../../playground/editor'
import { instrument, liaiseShim, type RunScope } from '../../playground/runner'
import { pickFetch } from '../../playground/route-fetch'
import { FAKE_ORIGIN, type Outcome, type UnreadMode } from '../../playground/fake-server'
import { createChallengeRunner, type ChallengeRun, type Load } from './harness'
import { CHECKS, TIMEOUT_S, checkDown, checkHealthy, checkLiaise, checkThrows, checkTypes, type CheckId, type CheckState } from './checks'
import { DOWN, ENDPOINT, FILE_NAME, HEALTHY, SCAFFOLD, SOLUTION } from './files'
import { describeThrown, formatArgs, inspect } from './format'
import { ApiDocs } from './ApiDocs'
import { Words } from '../keynote/Headline'
import { useMedia } from '../keynote/useMedia'
import './challenge.css'

export interface ChallengeProps {
  /** The site's base URL, with its trailing slash (import.meta.env.BASE_URL). */
  base: string
  /** Where Go to the docs leads: Quick start. */
  docsHref: string
  /** Go to the docs was clicked: the page remembers that this browser finished the intro. */
  onComplete: () => void
  /** Watch again: back to slide 1. */
  onReplay: () => void
}

const SAVE_KEY = 'liaise:intro-code'
const MODE_LABEL: Record<UnreadMode, string> = { healthy: 'Healthy', down: 'Down', slow: 'Slow' }
type Line = { id: number; tone: 'log' | 'error' | 'warn' | 'divider' | 'result' | 'note'; text: string }
type NetRow = { id: number; method: string; path: string; outcome: Outcome | 'pending'; ms?: number }

const readSaved = (): string | null => { try { return localStorage.getItem(SAVE_KEY) } catch { return null } }
const writeSaved = (code: string) => { try { localStorage.setItem(SAVE_KEY, code) } catch { /* blocked storage: the draft just isn't kept */ } }
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const sleep = (ms: number) => new Promise((r) => setTimeout(r, reduced() ? 0 : ms))
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const RUN_KEYS = isMac ? '⌘↵' : 'Ctrl+↵'
const IDLE: Record<CheckId, CheckState> = { liaise: { status: 'idle' }, healthy: { status: 'idle' }, down: { status: 'idle' }, throws: { status: 'idle' }, types: { status: 'idle' } }
const RUNNING: Record<CheckId, CheckState> = { liaise: { status: 'running' }, healthy: { status: 'running' }, down: { status: 'running' }, throws: { status: 'running' }, types: { status: 'running' } }

// Small pieces ---------------------------------------------------------------------------
const Icon = ({ d, size = 18, fill }: { d: string; size?: number; fill?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
)
const PlayIcon = () => <Icon size={14} fill d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
const StopIcon = () => <Icon size={14} fill d="M7 7h10v10H7z" />


function Mark({ status }: { status: CheckState['status'] }) {
  return (
    <span className={`mark ${status}`} aria-hidden="true">
      {status === 'pass' && <Icon size={14} d="M5 12.5l4.5 4.5L19 7.5" />}
      {status === 'fail' && <Icon size={13} d="M7 7l10 10M17 7L7 17" />}
    </span>
  )
}

function ServerSwitch({ mode, onMode, disabled }: { mode: UnreadMode; onMode: (m: UnreadMode) => void; disabled: boolean }) {
  return (
    <div className="server" role="radiogroup" aria-label="Server">
      <span className="server-label">Server</span>
      <div className="seg-group">
        {(['healthy', 'down', 'slow'] as UnreadMode[]).map(m => (
          <button
            key={m} type="button" role="radio" aria-checked={mode === m} disabled={disabled}
            className={`seg-opt ${m}${mode === m ? ' on' : ''}`} onClick={() => onMode(m)}
          >
            <span className="dot" aria-hidden="true" />{MODE_LABEL[m]}
          </button>
        ))}
      </div>
    </div>
  )
}


function NetworkTable({ rows }: { rows: NetRow[] }) {
  if (!rows.length) return <p className="empty">Requests to {FAKE_ORIGIN} show up here.</p>
  return (
    <table className="net">
      <thead><tr><th>Method</th><th>Path</th><th>Status</th><th className="num">Time</th></tr></thead>
      <tbody>
        {rows.map((r) => {
          const tone = r.outcome === 'pending' ? 'pending' : typeof r.outcome === 'number' ? (r.outcome < 400 ? 'ok' : 'err') : r.outcome
          return (
            <tr key={r.id}>
              <td className="m">{r.method}</td>
              <td className="p" title={r.path}>{r.path}</td>
              <td className={`s ${tone}`}>{r.outcome === 'pending' ? <span className="pulse">pending</span> : r.outcome}</td>
              <td className="num">{r.ms === undefined ? '' : `${r.ms} ms`}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function Challenge(props: ChallengeProps) {
  const small = useMedia('(max-width: 767px)')
  const [failed, setFailed] = useState(false)
  if (small) return <Reader {...props} why="On a larger screen this step is an editor and five checks. Here is one way to write it:" />
  if (failed) return <Reader {...props} why="The editor didn't load. Here is one way to write it:" />
  return <Workbench {...props} onFail={() => setFailed(true)} />
}

/** No editor (a phone, or Monaco failed to load): the brief, a solution to read, and the way on. */
function Reader({ docsHref, onComplete, onReplay, why }: ChallengeProps & { why: string }) {
  return (
    <div className="reader">
      <p className="eyebrow"><span className="n">10</span>Your turn</p>
      <h2 className="brief-title"><Words text="Show the unread count." className="w" /></h2>
      <p className="brief-body">{why}</p>
      <pre className="solution">{SOLUTION}</pre>
      <div className="done-actions">
        <a className="pill" href={docsHref} onClick={onComplete}>Go to the docs →</a>
        <button type="button" className="link-btn" onClick={onReplay}>Watch again</button>
      </div>
    </div>
  )
}

function Workbench({ base, docsHref, onComplete, onReplay, onFail }: ChallengeProps & { onFail: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const ed = useRef<MountedEditor | null>(null)
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<UnreadMode>('healthy')
  const [busy, setBusy] = useState<null | 'run' | 'check'>(null)
  const [tab, setTab] = useState<'console' | 'network'>('console')
  const [lines, setLines] = useState<Line[]>([])
  const [rows, setRows] = useState<NetRow[]>([])
  const [unseen, setUnseen] = useState(0)
  const [checks, setChecks] = useState(IDLE)
  const [checkedCode, setCheckedCode] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [solved, setSolved] = useState(false)
  const [docs, setDocs] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [pristine, setPristine] = useState(true)

  const lineSeq = useRef(0)
  const push = useCallback((tone: Line['tone'], text: string) => {
    setLines((prev) => [...prev.slice(-400), { id: ++lineSeq.current, tone, text }])
  }, [])
  const tabRef = useRef(tab)
  tabRef.current = tab
  useEffect(() => { if (tab === 'network') setUnseen(0) }, [tab])

  // The runner: while code runs, fetch and the console are the run's, and the fake API answers.
  const runner = useMemo(() => createChallengeRunner({
    scope: window as unknown as RunScope,
    print: (args, tone) => push(tone, formatArgs(args)),
    passThrough: (input) => pickFetch(input, { pageOrigin: location.origin }) === 'page',
    onRequest: ({ id, method, path }) => {
      setRows((prev) => [...prev.slice(-200), { id, method, path, outcome: 'pending' }])
      if (tabRef.current !== 'network') setUnseen((n) => n + 1)
    },
    onSettle: ({ id, outcome, ms }) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, outcome, ms } : r))),
  }), [push])
  useEffect(() => () => runner.stop(), [runner])

  // The reader's file, loaded for one run as /playground/ loads an example: liaise is the site's
  // build (public/liaise), and every client the file makes carries the run's gate.
  const lib = `${location.origin}${base}liaise/`
  const loadJs = (js: string): Load => async (run) => {
    const shim = URL.createObjectURL(new Blob([liaiseShim(run.id, lib)], { type: 'text/javascript' }))
    const url = URL.createObjectURL(new Blob([instrument(js, run.id, shim, lib)], { type: 'text/javascript' }))
    try { return await import(/* @vite-ignore */ url) } finally { URL.revokeObjectURL(url); URL.revokeObjectURL(shim) }
  }

  // Monaco, mounted once per visit to step 10 and disposed on leaving, so coming back mounts it again.
  const runRef = useRef<() => void>(() => {})
  const checkedRef = useRef<string | null>(null)
  checkedRef.current = checkedCode
  useEffect(() => {
    let mounted: MountedEditor | undefined
    let gone = false
    let save: number | undefined
    import('../../playground/editor')
      .then(({ mountEditor }) => mountEditor(host.current!, {
        sources: { unread: readSaved() ?? SCAFFOLD }, current: 'unread', base,
        onRun: () => runRef.current(),
        onChange: (value) => {
          window.clearTimeout(save)
          save = window.setTimeout(() => writeSaved(value), 400)
          if (checkedRef.current !== null) setStale(value !== checkedRef.current)
          setPristine(value === SCAFFOLD)
        },
      }))
      .then((editor) => {
        if (gone) { editor.dispose(); return }
        mounted = editor
        ed.current = editor
        setPristine(editor.value() === SCAFFOLD)
        setReady(true)
      })
      .catch((e) => { console.warn('intro: the editor did not load.', e); if (!gone) onFail() })
    return () => { gone = true; window.clearTimeout(save); mounted?.dispose(); ed.current = null }
  }, [base]) // eslint-disable-line react-hooks/exhaustive-deps

  const report = (r: ChallengeRun, limitS: number) => {
    if (r.loadError !== undefined) push('error', `The file didn't load: ${describeThrown(r.loadError)}`)
    else if (r.ended === 'stopped') push('note', 'Stopped.')
    else if (r.ended === 'timeout') push('warn', `Stopped after ${limitS} seconds: unreadLabel() was still running.`)
    else if (!r.exported) push('note', 'Ran the file. There is no exported unreadLabel to call.')
    else if (r.threw !== undefined) push('error', `unreadLabel() threw ${describeThrown(r.threw)}`)
    else if (r.returned) push('result', `unreadLabel() returned ${inspect(r.returned.value)}`)
  }

  // Run: once, against the server as the switch has it.
  const run = async () => {
    const editor = ed.current
    if (!editor) return
    if (busy === 'run') { runner.stop(); return }
    if (busy) return
    setBusy('run')
    setTab('console')
    try {
      const { js, diagnostics } = await editor.compile()
      push('divider', `Run · server ${MODE_LABEL[mode]}`)
      if (diagnostics.length) push('warn', `${diagnostics.length} type error${diagnostics.length === 1 ? '' : 's'}, running it anyway. Line ${diagnostics[0].line}: ${diagnostics[0].message}`)
      report(await runner.run(loadJs(js), { mode, timeoutMs: 15_000 }), 15)
    } catch (e) {
      push('error', `The editor couldn't compile the file: ${describeThrown(e)}`)
    } finally {
      setBusy(null)
    }
  }
  runRef.current = () => { void run() }

  // Check: twice, healthy then down, ticking each check as its evidence comes in.
  const check = async () => {
    const editor = ed.current
    if (!editor || busy) return
    setBusy('check')
    setConfirming(false)
    setStale(false)
    setChecks(RUNNING)
    const tick = async (id: CheckId, state: CheckState) => { await sleep(220); setChecks((prev) => ({ ...prev, [id]: state })) }
    const source = editor.value()
    try {
      const { js, diagnostics } = await editor.compile()
      setTab('console')
      push('divider', 'Check 1 of 2 · server Healthy')
      const a = await runner.run(loadJs(js), { mode: 'healthy', timeoutMs: TIMEOUT_S * 1000 })
      report(a, TIMEOUT_S)
      await tick('liaise', checkLiaise(a))
      await tick('healthy', checkHealthy(a))
      push('divider', 'Check 2 of 2 · server Down')
      const b = await runner.run(loadJs(js), { mode: 'down', timeoutMs: TIMEOUT_S * 1000 })
      report(b, TIMEOUT_S)
      const results: Record<CheckId, CheckState> = {
        liaise: checkLiaise(a), healthy: checkHealthy(a), down: checkDown(b, source), throws: checkThrows(a, b), types: checkTypes(diagnostics),
      }
      await tick('down', results.down)
      await tick('throws', results.throws)
      await tick('types', results.types)
      setCheckedCode(source)
      setStale(editor.value() !== source)
      const passed = CHECKS.filter((c) => results[c.id].status === 'pass').length
      push(passed === CHECKS.length ? 'result' : 'note', `${passed} of ${CHECKS.length} checks pass.`)
      if (passed === CHECKS.length) { await sleep(800); setSolved(true) }
    } catch (e) {
      push('error', `The check couldn't run: ${describeThrown(e)}`)
      setChecks(IDLE)
    } finally {
      setBusy(null)
    }
  }

  const startOver = () => { ed.current?.replace(SCAFFOLD); setRevealed(false); ed.current?.focus() }
  const showSolution = () => { ed.current?.replace(SOLUTION); setConfirming(false); setRevealed(true); ed.current?.focus() }

  // The console and the network table follow their newest line.
  const consoleEl = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = consoleEl.current; if (el) el.scrollTop = el.scrollHeight }, [lines, tab])
  const netEl = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = netEl.current; if (el) el.scrollTop = el.scrollHeight }, [rows, tab])
  const closeDocs = useCallback(() => setDocs(false), [])

  // The success screen takes focus on its primary action; Escape goes back to the editor.
  const docsLink = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (!solved) return
    docsLink.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSolved(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [solved])
  const passCount = CHECKS.filter((c) => checks[c.id].status === 'pass').length
  const anyResult = CHECKS.some((c) => checks[c.id].status === 'pass' || checks[c.id].status === 'fail')

  return (
    <>
      <div className="work-wrap" inert={docs || solved}>
        <main className="work">
          <div className="col-left">
            <section className="editor-card" aria-label="Editor">
              <div className="glow" aria-hidden="true" />
              <div className="toolbar">
                <span className="file"><span className="file-dot" aria-hidden="true" />{FILE_NAME}</span>
                <ServerSwitch mode={mode} onMode={setMode} disabled={busy === 'check'} />
                <button type="button" className={`run${busy === 'run' ? ' stop' : ''}`} onClick={() => void run()} disabled={!ready || busy === 'check'} title={`Run (${RUN_KEYS})`}>
                  {busy === 'run' ? <><StopIcon /> Stop</> : <><PlayIcon /> Run <kbd>{RUN_KEYS}</kbd></>}
                </button>
              </div>
              <div className="monaco-host" ref={host}>
                {!ready && <pre className="placeholder">{SCAFFOLD}</pre>}
              </div>
            </section>

            <section className="panel" aria-label="Output">
              <div className="panel-tabs" role="tablist" aria-label="Output">
                <button type="button" role="tab" id="tab-console" aria-selected={tab === 'console'} aria-controls="pane-console" className={tab === 'console' ? 'on' : ''} onClick={() => setTab('console')}>Console</button>
                <button type="button" role="tab" id="tab-network" aria-selected={tab === 'network'} aria-controls="pane-network" className={tab === 'network' ? 'on' : ''} onClick={() => setTab('network')}>
                  Network{rows.length > 0 && <span className="count">{rows.length}</span>}{unseen > 0 && <span className="new" aria-label={`${unseen} new`} />}
                </button>
                <button type="button" className="clear" onClick={() => { setLines([]); setRows([]); setUnseen(0) }}>Clear</button>
              </div>
              <div id="pane-console" role="tabpanel" aria-labelledby="tab-console" className="pane console" hidden={tab !== 'console'} ref={consoleEl}>
                {lines.length === 0
                  ? <p className="empty">Press Run, and what your code logs shows up here.</p>
                  : lines.map(l => <div key={l.id} className={`ln ${l.tone}`}>{l.text}</div>)}
              </div>
              <div id="pane-network" role="tabpanel" aria-labelledby="tab-network" className="pane network" hidden={tab !== 'network'} ref={netEl}>
                <NetworkTable rows={rows} />
              </div>
            </section>
          </div>

          <div className="col-right">
            <section className="brief" aria-labelledby="brief-title">
              <p className="eyebrow"><span className="n">10</span>Your turn</p>
              <h1 id="brief-title" className="brief-title"><Words text="Show the unread count." className="w" /></h1>
              <p className="brief-body">
                Write <code>unreadLabel()</code>. It calls <code>GET {ENDPOINT}</code> through liaise and returns <code>'{HEALTHY}'</code>.
              </p>
              <p className="brief-body">
                When the server is down it returns <code>'{DOWN}'</code>. Use <code>error.kind</code>, and never throw.
              </p>
              <p className="brief-meta">
                <button type="button" className="text-btn" onClick={() => setDocs(true)}>The API docs</button> list every endpoint.<span className="kbd-hint"> Run your code with <kbd>{RUN_KEYS}</kbd>.</span>
              </p>
            </section>

            <section className={`checks${stale ? ' stale' : ''}`} aria-labelledby="checks-title">
              <div className="check-actions">
                <button type="button" className="pill" onClick={() => void check()} disabled={!ready || busy !== null}>
                  {busy === 'check' ? 'Checking…' : 'Check my code'}
                </button>
                {!confirming && <button type="button" className="text-btn" onClick={() => setConfirming(true)} disabled={!ready || busy !== null}>Show a solution</button>}
                {!confirming && !pristine && <button type="button" className="text-btn quiet-btn" onClick={startOver} disabled={!ready || busy !== null}>Start over</button>}
              </div>
              {confirming && (
                <div className="confirm" role="group" aria-label="Show a solution">
                  <p>Replace your code with a working solution? Undo ({isMac ? '⌘Z' : 'Ctrl+Z'}) brings yours back.</p>
                  <div className="confirm-actions">
                    <button type="button" className="pill small" onClick={showSolution}>Replace my code</button>
                    <button type="button" className="text-btn" onClick={() => setConfirming(false)}>Keep mine</button>
                  </div>
                </div>
              )}
              {revealed && !confirming && <p className="stale-note">A solution is in the editor. Read it, then check it.</p>}
              <div className="checks-head">
                <h2 id="checks-title">Checks</h2>
                <span className="checks-sub">{anyResult && busy !== 'check' ? `${passCount} of ${CHECKS.length} pass` : 'Runs your code twice: healthy, then down.'}</span>
              </div>
              <ol className="check-list" aria-live="polite">
                {CHECKS.map((c, i) => {
                  const s = checks[c.id]
                  return (
                    <li key={c.id} className={`check ${s.status}`}>
                      <Mark status={s.status} />
                      <div className="check-text">
                        <span className="check-label"><span className="n">{i + 1}</span>{c.label}</span>
                        {s.status === 'fail' && s.reason && <span className="check-why">{s.reason}</span>}
                        {s.status === 'pass' && s.reason && <span className="check-ok">{s.reason}</span>}
                      </div>
                    </li>
                  )
                })}
              </ol>
              {stale && <p className="stale-note">You changed the code after this check. Check again to update it.</p>}
            </section>
          </div>
        </main>
      </div>

      <ApiDocs open={docs} onClose={closeDocs} />

      {solved && (
        <section className="done" role="dialog" aria-modal="true" aria-labelledby="done-title">
          <div className="done-glow" aria-hidden="true" />
          <div className="done-copy">
            <p className="eyebrow"><span className="n">5 / 5</span>Checks pass</p>
            <h2 id="done-title" className="done-title"><Words text="That's liaise." className="w" step={90} /></h2>
            <p className="done-body">You defined an endpoint, called it, and handled a server that was down, without a try/catch. The docs have the rest.</p>
            <div className="done-actions">
              <a ref={docsLink} className="pill big" href={docsHref} onClick={onComplete}>Go to the docs →</a>
              <button type="button" className="link-btn" onClick={onReplay}>Watch again</button>
              <button type="button" className="text-btn" onClick={() => setSolved(false)}>Keep editing</button>
            </div>
          </div>
        </section>
      )}
    </>
  )
}
