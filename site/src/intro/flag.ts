// The front page plays the intro once. Finishing it (Go to the docs) or skipping it (Skip to docs,
// or the Docs link on the front page) leaves this mark, and index.astro's head script then sends
// the browser to Quick start before anything paints. /intro/ always plays, and watching it again
// keeps the mark. The key starts with liaise: because iremlopsum.github.io, and so its storage, is
// shared with the owner's other sites.
export const INTRO_KEY = 'liaise:intro'

/** Remembers that this browser has seen the intro. Never throws: blocked storage only means it plays again. */
export function rememberIntro(how: 'done' | 'skipped'): void {
  try { localStorage.setItem(INTRO_KEY, how) } catch { /* blocked or missing storage: the intro shows next time */ }
}
