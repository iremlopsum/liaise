// The page side of a look: which slide is showing, the Player's current frame, the
// caption for that frame, and Next / Back / Replay / Copy. Looks render all of this
// however they like; this hook only keeps it in sync with the Player.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlayerRef } from '@remotion/player'
import { CAPTIONS, COPY_TEXT, SLIDES, type Caption } from './slides'
import { cueAt } from './timeline'

export type Deck = {
  /** Pass to <Player ref={deck.playerRef} />. */
  playerRef: (player: PlayerRef | null) => void
  index: number
  count: number
  slideId: string
  frame: number
  duration: number
  /** The slide reached its end: show Copy and Next. */
  ended: boolean
  playing: boolean
  /** False until the reader presses start: browsers may block a page from playing on its own. */
  started: boolean
  /** Starts the deck. Call it from a click or key handler (that is the user gesture browsers want). */
  start: () => void
  caption: Caption | null
  /** The cue id showing, and the frame it started (for animating a caption in). */
  cue: { id: string; frame: number } | null
  /** Every caption of this slide in order, with the frame it starts. */
  captions: Array<Caption & { id: string; frame: number }>
  next: () => void
  back: () => void
  go: (i: number) => void
  replay: () => void
  togglePlay: () => void
  /** Jump to a frame of the current slide and keep playing (e.g. a caption's start frame). */
  seek: (frame: number) => void
  /** Copies this slide's code. Resolves true when the clipboard took it. */
  copy: () => Promise<boolean>
  copyText: string
}

export function useDeck(onFinish?: () => void): Deck {
  const ref = useRef<PlayerRef | null>(null)
  // A callback ref: the Player mounts after the first effects run, so effects key on it.
  const [player, setPlayer] = useState<PlayerRef | null>(null)
  const playerRef = useCallback((p: PlayerRef | null) => { ref.current = p; setPlayer(p) }, [])
  const [index, setIndex] = useState(0)
  const [frame, setFrame] = useState(0)
  const [ended, setEnded] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [started, setStarted] = useState(false)
  const timeline = SLIDES[index]
  const slideId = timeline.script.id

  useEffect(() => {
    const p = player
    if (!p) return
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame)
    const onEnded = () => { setEnded(true); setPlaying(false) }
    const onPlay = () => { setPlaying(true); setEnded(false) }
    const onPause = () => setPlaying(false)
    p.addEventListener('frameupdate', onFrame)
    p.addEventListener('ended', onEnded)
    p.addEventListener('play', onPlay)
    p.addEventListener('pause', onPause)
    return () => {
      p.removeEventListener('frameupdate', onFrame)
      p.removeEventListener('ended', onEnded)
      p.removeEventListener('play', onPlay)
      p.removeEventListener('pause', onPause)
    }
  }, [player])

  useEffect(() => {
    setFrame(0); setEnded(false)
    if (player) { player.seekTo(0); if (started) player.play() }
  }, [index, player]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(() => { setStarted(true); const p = ref.current; if (p) { p.seekTo(0); p.play() } }, [])

  const go = useCallback((i: number) => { if (i >= 0 && i < SLIDES.length) setIndex(i) }, [])
  const next = useCallback(() => { if (index < SLIDES.length - 1) setIndex(index + 1); else onFinish?.() }, [index, onFinish])
  const back = useCallback(() => { if (index > 0) setIndex(index - 1) }, [index])
  const seek = useCallback((f: number) => { const p = ref.current; if (p) { p.seekTo(f); p.play() } }, [])
  const replay = useCallback(() => { const p = ref.current; if (p) { p.seekTo(0); p.play() } }, [])
  const togglePlay = useCallback(() => { const p = ref.current; if (!p) return; if (p.isPlaying()) p.pause(); else { if (ended) p.seekTo(0); p.play() } }, [ended])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea')) return
      if (!started) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); start() } return }
      if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
      else if (e.key === ' ') { e.preventDefault(); togglePlay() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, back, togglePlay, started, start])

  const copyText = COPY_TEXT[slideId]
  const copy = useCallback(async () => {
    try { await navigator.clipboard.writeText(copyText); return true } catch { return false }
  }, [copyText])

  const cue = cueAt(timeline, frame)
  const captions = timeline.cues.map(c => ({ id: c.id, frame: c.frame, ...CAPTIONS[slideId][c.id] }))
  return {
    playerRef, index, count: SLIDES.length, slideId, frame, duration: timeline.duration, ended, playing, started, start,
    caption: cue ? CAPTIONS[slideId][cue.id] : null, cue, captions,
    next, back, go, replay, togglePlay, seek, copy, copyText,
  }
}
