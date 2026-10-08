// The intro's React island. components/Intro.astro imports this when Start is pressed (and earlier,
// when the browser is idle), so React, Remotion and the slides never load before they're wanted.
import { createRoot } from 'react-dom/client'
import { App } from './keynote/App'

export interface IntroOptions {
  /** The site's base URL, with its trailing slash. */
  base: string
  /** Quick start: where Go to the docs leads. */
  docsHref: string
  /** Go to the docs after passing: remember that this browser finished the intro. */
  onComplete: () => void
}

export function mountIntro(host: HTMLElement, opts: IntroOptions): void {
  createRoot(host).render(<App {...opts} />)
}
