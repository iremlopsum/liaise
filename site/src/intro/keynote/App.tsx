// The intro, Keynote look: a black stage, a large headline beside the editor that arrives word by
// word as each step of code starts, and the editor in a soft light. Slides change with a cut
// through black. Step 10 is the challenge (../challenge/Challenge.tsx), loaded when reached.
// Ported from docs/prototypes/intro-keynote-2026-10-08/src/look-1.tsx. The start screen is static
// HTML now (components/Intro.astro); it mounts this when Start is pressed, so playback starts here.
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { useDeck } from '../engine/deck'
import { SLIDES } from '../engine/slides'
import { FPS } from '../length'
import { SIZE, Stage, type Layout } from './Stage'
import { Headline } from './Headline'
import { useMedia } from './useMedia'
import './keynote.css'

// Monaco comes with it: nothing of the editor loads before step 10.
const Challenge = lazy(() => import('../challenge/Challenge'))

const NAMES: Record<string, string> = {
  setup: 'Setup', call: 'The call', dedupe: 'Dedupe', share: 'Share', middleware: 'Middleware',
  pagination: 'Pagination', polling: 'Polling', cache: 'Caching', together: 'Search, finished',
}
/** Nine slides and the challenge. */
const STEPS = SLIDES.length + 1
const pad = (n: number) => String(n).padStart(2, '0')
const CUT_MS = 320

// Icons ----------------------------------------------------------------------
const Icon = ({ d, fill }: { d: string; fill?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
)
const BackIcon = () => <Icon d="M15 5l-7 7 7 7" />
const NextIcon = () => <Icon d="M9 5l7 7-7 7" />
const PlayIcon = () => <Icon fill d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
const PauseIcon = () => <Icon fill d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
const ReplayIcon = () => <Icon d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5" />
const CheckIcon = () => <Icon d="M5 12.5l4.5 4.5L19 7.5" />

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button type="button" className="icon-btn" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>
}

// The copy fallback: the clipboard said no, so show the code selected. -------------
function ManualCopy({ text, onClose }: { text: string; onClose: () => void }) {
  const pre = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const el = pre.current
    if (!el) return
    el.focus({ preventScroll: true })
    window.getSelection()?.selectAllChildren(el)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="manual" role="dialog" aria-label="Copy the code by hand">
      <div className="manual-head">
        <p>The browser blocked copying. The code is selected: press <kbd>⌘C</kbd> or <kbd>Ctrl+C</kbd>.</p>
        <button type="button" className="link-btn" onClick={onClose}>Done</button>
      </div>
      <pre ref={pre} tabIndex={-1}>{text}</pre>
    </div>
  )
}

export interface AppProps {
  base: string
  docsHref: string
  onComplete: () => void
}

export function App({ base, docsHref, onComplete }: AppProps) {
  const [finished, setFinished] = useState(false)
  const onFinish = useCallback(() => setFinished(true), [])
  const deck = useDeck(onFinish)

  // Our own handle on the Player, beside the deck's. Remotion's seekTo() on a playing
  // Player marks it to resume after the seek and never clears that mark when play() is
  // called right away (which deck.seek and deck.replay do), so the slide would loop back
  // to frame 0 at its end instead of stopping. Pausing first avoids the mark.
  const player = useRef<PlayerRef | null>(null)
  const [hasPlayer, setHasPlayer] = useState(false)
  const setPlayer = useCallback((p: PlayerRef | null) => { player.current = p; deck.playerRef(p); if (p) setHasPlayer(true) }, [deck.playerRef])

  // Start was pressed on the static start screen: that press is the gesture browsers want before
  // anything plays. The deck plays once it holds the Player, which is after the deck's own seekTo(0)
  // on it: started any earlier, that seek lands on a playing Player (the mark above), and slide 1
  // loops at its end instead of stopping.
  useEffect(() => { if (hasPlayer && !deck.started) deck.start() }, [hasPlayer]) // eslint-disable-line react-hooks/exhaustive-deps

  const seek = (f: number) => { if (player.current?.isPlaying()) player.current.pause(); deck.seek(f) }
  const replay = () => { if (player.current?.isPlaying()) player.current.pause(); deck.replay() }
  const tall = useMedia('(max-width: 640px)')
  const still = useMedia('(prefers-reduced-motion: reduce)')
  const layout: Layout = tall ? 'tall' : 'wide'
  const size = SIZE[layout]
  const inputProps = useMemo(() => ({ slide: deck.index, layout, still }), [deck.index, layout, still])

  // The keynote cut: the stage fades to black and settles back a touch, then the next
  // slide's editor rises out of the dark (that half lives in the composition).
  const [cutting, setCutting] = useState(false)
  const busy = useRef(false)
  const cut = useCallback((fn: () => void) => {
    if (busy.current) return
    if (still) { fn(); return }
    busy.current = true
    setCutting(true)
    window.setTimeout(() => { fn(); busy.current = false; setCutting(false) }, CUT_MS)
  }, [still])

  const goNext = () => { if (!finished) cut(deck.next) }
  const goBack = () => { if (finished) cut(() => setFinished(false)); else if (deck.index > 0) cut(deck.back) }
  const goTo = (i: number) => cut(() => { setFinished(false); deck.go(i) })
  const restart = () => cut(() => { setFinished(false); if (deck.index === 0) replay(); else deck.go(0) })

  // ← and → go through the cut too: this listener runs before the deck's own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!deck.started || e.metaKey || e.ctrlKey || e.altKey) return
      if ((e.target as HTMLElement)?.closest?.('input, textarea, pre')) return
      const arrow = e.key === 'ArrowRight' || e.key === 'ArrowLeft'
      if (!arrow && !(finished && e.key === ' ')) return
      e.stopPropagation()
      e.preventDefault()
      if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'ArrowLeft') goBack()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  // Copy, with the confirmation and the by-hand fallback.
  const [copied, setCopied] = useState(false)
  const [manual, setManual] = useState(false)
  const copiedTimer = useRef<number | undefined>(undefined)
  useEffect(() => { setCopied(false); setManual(false) }, [deck.index])
  const onCopy = async () => {
    const ok = await deck.copy()
    if (ok) {
      setCopied(true)
      window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2400)
    } else setManual(true)
  }
  const closeManual = useCallback(() => setManual(false), [])

  // Move focus to the primary action when a slide ends, so Enter copies.
  const copyBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (deck.ended && !finished) copyBtn.current?.focus({ preventScroll: true }) }, [deck.ended, finished])

  const onSegment = (e: React.MouseEvent<HTMLButtonElement>, i: number) => {
    if (i !== deck.index || finished) { goTo(i); return }
    const r = e.currentTarget.getBoundingClientRect()
    seek(Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (deck.duration - 1)))
  }

  // Step 10 is the last progress segment; going there stops the slide that was playing.
  const toChallenge = () => cut(() => { player.current?.pause(); setFinished(true) })

  // If the Player still didn't start (the bundle arrived after the gesture expired, or a browser
  // wants the gesture on the Player itself), the paused mark shows, and a click on the stage plays.
  const [waited, setWaited] = useState(false)
  useEffect(() => { const t = window.setTimeout(() => setWaited(true), 600); return () => window.clearTimeout(t) }, [])

  const slideId = deck.slideId
  const progress = deck.ended ? 1 : deck.frame / Math.max(1, deck.duration - 1)
  const caption = deck.caption && deck.cue && !cutting && !finished
    ? { key: `${deck.index}:${deck.cue.id}`, title: deck.caption.title, body: deck.caption.body }
    : null
  const showEnd = deck.ended && !cutting && !finished
  const paused = deck.started && !deck.playing && !deck.ended && !cutting && (deck.frame > 0 || waited)

  return (
    <div className={`intro-app${finished ? ' finished' : ''}`}>
      <div className="bar">
        <div className="progress" role="group" aria-label="Steps">
          <div className="segs">
            {SLIDES.map((s, i) => {
              const done = finished || i < deck.index
              const now = !finished && i === deck.index
              return (
                <button
                  key={s.script.id} type="button" className={`seg${done ? ' done' : ''}${now ? ' now' : ''}`}
                  onClick={e => onSegment(e, i)} aria-current={now ? 'step' : undefined}
                  aria-label={now ? `Slide ${i + 1}, ${NAMES[s.script.id]}: jump within it` : `Go to slide ${i + 1}, ${NAMES[s.script.id]}`}
                >
                  <span className="track"><span className="fill" style={now ? { width: `${progress * 100}%` } : undefined} /></span>
                </button>
              )
            })}
            <button
              type="button" className={`seg${finished ? ' now' : ''}`} onClick={() => { if (!finished) toChallenge() }}
              aria-current={finished ? 'step' : undefined} aria-label={`Go to step ${STEPS}, Your turn`}
            >
              <span className="track"><span className="fill" style={finished ? { width: '100%' } : undefined} /></span>
            </button>
          </div>
          <span className="count" aria-live="off">{pad(finished ? STEPS : deck.index + 1)} <span>/ {pad(STEPS)}</span></span>
        </div>
        <div className="transport">
          <IconButton label="Back" onClick={goBack} disabled={!finished && deck.index === 0}><BackIcon /></IconButton>
          <IconButton label={deck.playing ? 'Pause' : 'Play'} onClick={deck.togglePlay} disabled={finished}>{deck.playing ? <PauseIcon /> : <PlayIcon />}</IconButton>
          <IconButton label="Replay this slide" onClick={replay} disabled={finished}><ReplayIcon /></IconButton>
          <IconButton label="Next" onClick={goNext} disabled={finished}><NextIcon /></IconButton>
        </div>
      </div>

      <main className={`main${cutting ? ' cut' : ''}`}>
        <section className="captions" aria-label="Caption">
          <p className="eyebrow" key={slideId}>{pad(deck.index + 1)}<span>{NAMES[slideId]}</span></p>
          <Headline caption={caption} />
          <nav className="cues" aria-label="Steps in this slide">
            {deck.captions.map(c => (
              <button
                key={`${slideId}-${c.id}`} type="button" className={c.id === deck.cue?.id ? 'on' : ''}
                onClick={() => seek(c.frame)} title={c.title} aria-label={`Jump to: ${c.title}`}
              />
            ))}
          </nav>
        </section>

        <section className={`stage${deck.ended ? ' ended' : ''}`} aria-label="Editor">
          <div className="screen" style={{ aspectRatio: `${size.width} / ${size.height}`, ['--ratio' as string]: size.width / size.height }}>
            <div className="glow" key={`glow-${deck.index}`} aria-hidden="true" />
            <div className="player" onClick={deck.ended ? undefined : deck.togglePlay}>
              <Player
                ref={setPlayer}
                key={deck.index}
                component={Stage}
                inputProps={inputProps}
                durationInFrames={deck.duration}
                fps={FPS}
                compositionWidth={size.width}
                compositionHeight={size.height}
                moveToBeginningWhenEnded={false}
                style={{ width: '100%', height: '100%' }}
              />
            </div>
            {paused && <div className="paused" aria-hidden="true"><PlayIcon /></div>}
            {manual && <ManualCopy text={deck.copyText} onClose={closeManual} />}
          </div>
          <div className={`endrow${showEnd ? ' on' : ''}`}>
            <button ref={copyBtn} type="button" className={`pill${copied ? ' copied' : ''}`} onClick={onCopy} tabIndex={showEnd ? 0 : -1}>
              {copied ? <><CheckIcon /> Copied</> : 'Copy code'}
            </button>
            <button type="button" className="link-btn" onClick={goNext} tabIndex={showEnd ? 0 : -1}>Next →</button>
          </div>
        </section>
      </main>

      {finished && (
        <section className="step10" aria-label="Your turn">
          <Suspense fallback={<p className="loading">Loading the editor…</p>}>
            <Challenge base={base} docsHref={docsHref} onComplete={onComplete} onReplay={restart} />
          </Suspense>
        </section>
      )}
    </div>
  )
}
