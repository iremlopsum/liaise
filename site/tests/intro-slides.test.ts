import { describe, it, expect } from 'vitest'
import { SLIDES, CAPTIONS, COPY_TEXT, SOURCES } from '../src/intro/engine/slides'
import { stateAt } from '../src/intro/engine/timeline'
import { PREVIEWS } from '../src/intro/engine/previews'
import { introLength } from '../src/intro/length'

// The files each slide means to end with, by slide id. A script that types something else is
// caught here, and docs:types compiles these same SOURCES against liaise.
const ENDS: Record<string, Record<string, string>> = {
  setup: { 'api.ts': SOURCES.API_TS },
  call: { 'profile.ts': SOURCES.PROFILE_TS },
  dedupe: { 'api.ts': SOURCES.API_TS_DEDUPE, 'Search.tsx': SOURCES.SEARCH_TSX },
  share: { 'components.tsx': SOURCES.COMPONENTS_TSX },
  middleware: { 'auth.ts': SOURCES.AUTH_TS },
  pagination: { 'Blog.tsx': SOURCES.BLOG_TSX },
  polling: { 'Bell.tsx': SOURCES.BELL_TSX },
  cache: { 'weather.ts': SOURCES.WEATHER_TS },
  together: { 'api.ts': SOURCES.API_FINAL, 'Search.tsx': SOURCES.SEARCH_FINAL },
}
const trim = (s: string) => s.replace(/\n$/, '')

describe('intro slides', () => {
  it('has the nine slides, in order', () => {
    expect(SLIDES.map((s) => s.script.id)).toEqual(Object.keys(ENDS))
  })

  it.each(SLIDES.map((s) => [s.script.id, s] as const))('%s ends with exactly the files it means to', (id, t) => {
    const end = stateAt(t, t.duration)
    for (const [name, want] of Object.entries(ENDS[id]))
      expect(trim(end.files.find((f) => f.name === name)?.text ?? '(missing)'), `${id}: ${name}`).toBe(trim(want))
  })

  it('keeps every line at 66 characters or fewer, so it fits beside a preview', () => {
    for (const t of SLIDES)
      for (const f of stateAt(t, t.duration).files)
        f.text.split('\n').forEach((line, i) =>
          expect(line.length, `${t.script.id}: ${f.name}:${i + 1}`).toBeLessThanOrEqual(66))
  })

  it('has a caption for every cue', () => {
    for (const t of SLIDES)
      for (const c of t.cues) expect(CAPTIONS[t.script.id]?.[c.id], `${t.script.id}.${c.id}`).toBeDefined()
  })

  it('copies, at the end of each slide, the file it finished', () => {
    expect(COPY_TEXT).toEqual({
      setup: SOURCES.API_TS, call: SOURCES.PROFILE_TS, dedupe: SOURCES.SEARCH_TSX, share: SOURCES.COMPONENTS_TSX,
      middleware: SOURCES.AUTH_TS, pagination: SOURCES.BLOG_TSX, polling: SOURCES.BELL_TSX, cache: SOURCES.WEATHER_TS,
      together: SOURCES.SEARCH_FINAL,
    })
  })

  it('has a preview for every slide that runs one', () => {
    for (const t of SLIDES)
      if (t.placed.some((a) => a.do === 'preview'))
        expect(t.script.id === 'dedupe' || t.script.id in PREVIEWS, t.script.id).toBe(true)
  })
})

describe('introLength', () => {
  it('rounds the running time to the nearest half minute', () => {
    expect(introLength(204 * 30)).toBe('3½ minutes')
    expect(introLength(180 * 30)).toBe('3 minutes')
    expect(introLength(100 * 30)).toBe('1½ minutes')
    expect(introLength(60 * 30)).toBe('1 minute')
  })
  it('is about 3½ minutes for the nine slides as they are', () => {
    expect(introLength()).toBe('3½ minutes')
  })
})
