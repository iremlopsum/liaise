// How long the intro plays, from the slides themselves, so no page states it by hand.
import { SLIDES } from './engine/slides'

/** Frames per second of every slide: the Player's fps, and what the scripts' frame counts assume. */
export const FPS = 30

/** The slides' running time to the nearest half minute, as words: '3½ minutes'. */
export function introLength(frames = SLIDES.reduce((n, s) => n + s.duration, 0)): string {
  const halves = Math.max(1, Math.round(frames / FPS / 30))
  const whole = Math.floor(halves / 2)
  return `${whole || ''}${halves % 2 ? '½' : ''} minute${halves === 2 ? '' : 's'}`
}
