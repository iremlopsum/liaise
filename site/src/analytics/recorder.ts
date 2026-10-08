// The page view's record, in memory only. Every method is cheap and never throws; caps apply at push.
import { CAPS, emptyIntro, emptyStep10, type PageRecord, type Run, type Reason } from './schema'

type Init = Pick<PageRecord, 'pv' | 'path' | 'tags' | 'from' | 'tz' | 'lang' | 'browser' | 'os' | 'device'>
export type Recorder = ReturnType<typeof createRecorder>

export function createRecorder(init: Init, now: () => number) {
  const r: PageRecord = { v: 1, seq: 0, exit: true, engagedMs: 0, searches: [], copies: [], out: { github: 0, npm: 0, compare: 0 }, tabs: [], runs: [], editorFailed: false, intro: null, ...init }
  let dirty = true
  let current = 0                 // 0 = the start screen, 1–9 the slides, 10 step 10
  let timing: { i: number; since: number } | null = null
  let shownSlide = -1, visible = true
  let firstEditAt: number | null = null
  const touch = () => { dirty = true }
  const intro = () => (r.intro ??= emptyIntro())
  const step10 = () => (intro().step10 ??= emptyStep10())
  const slide = (i: number) => intro().slides[i]
  const reach = (step: number) => { const it = intro(); if (step > it.furthest) it.furthest = step; current = step }
  const stopTiming = () => { if (timing) { slide(timing.i).ms += now() - timing.since; timing = null } }
  const startTiming = () => { if (shownSlide >= 0 && visible && !timing) timing = { i: shownSlide, since: now() } }
  const bump = (i: number, k: 'pauses' | 'replays' | 'seeks' | 'back' | 'jumps') => { if (i >= 0 && i < 9) { slide(i)[k] += 1; touch() } }

  return {
    get dirty() { return dirty },
    snapshot(seq: number, engagedMs: number): PageRecord {
      if (timing) { stopTiming(); startTiming() }
      r.seq = seq; r.engagedMs = engagedMs; dirty = false
      return JSON.parse(JSON.stringify(r)) as PageRecord
    },
    visibility(v: boolean) { visible = v; if (v) startTiming(); else stopTiming() },
    internalLink() { if (r.exit) { r.exit = false; touch() } },
    search(q: string, n: number, pos: number | null) { if (r.searches.length < CAPS.searches) { r.searches.push({ q, n, pos }); touch() } },
    searchClick(q: string, pos: number) {
      const last = r.searches[r.searches.length - 1]
      if (last && last.q === q) last.pos = pos
      else if (r.searches.length < CAPS.searches) r.searches.push({ q, n: 0, pos })
      touch()
    },
    copy(block: string, ok: boolean) { if (r.copies.length < CAPS.copies) { r.copies.push({ block, ok }); touch() } },
    out(kind: 'github' | 'npm' | 'compare') { r.out[kind] += 1; touch() },
    tab(id: string) { if (r.tabs.length < CAPS.tabs) { r.tabs.push(id); touch() } },
    run(x: Run) { if (r.runs.length < CAPS.runs) { r.runs.push(x); touch() } },
    editorFailed() { r.editorFailed = true; touch() },
    introShown() { intro(); touch() },
    start(method: 'click' | 'enter', ms: number, prefetched: boolean) { intro().start ??= { method, ms, prefetched }; touch() },
    skip() { intro().skipFrom = current === 0 ? 'start' : current; touch() },
    slideShown(i: number) {
      stopTiming(); shownSlide = i; reach(i + 1)
      slide(i).reached = true; startTiming(); touch()
    },
    slideEnded(i: number) { if (i >= 0 && i < 9 && !slide(i).ended) { slide(i).ended = true; touch() } },
    pause(i: number) { bump(i, 'pauses') }, replay(i: number) { bump(i, 'replays') }, seek(i: number) { bump(i, 'seeks') },
    back(i: number) { bump(i, 'back') }, jump(i: number) { bump(i, 'jumps') },
    slideCopy(i: number, ok: boolean) { if (i >= 0 && i < 9) { slide(i).copies += 1; if (!ok) slide(i).copyFails += 1; touch() } },
    step10Shown() { stopTiming(); shownSlide = -1; reach(10); step10(); touch() },
    editor(kind: 'loaded' | 'reader' | 'error', loadMs = 0) { const t = step10(); t.editor = kind; t.loadMs = Math.round(loadMs); touch() },
    run10(mode: 'healthy' | 'down' | 'slow') { step10().runs[mode] += 1; touch() },
    attempt(pass: boolean[], reason: Reason | null) { const t = step10(); if (t.attempts.length < CAPS.attempts) { t.attempts.push({ pass, reason }); touch() } },
    solution() { step10().solution = true; touch() },
    startOver() { step10().startOver = true; touch() },
    drawer() { step10().drawer = true; touch() },
    firstEdit() { if (firstEditAt === null) firstEditAt = now() },
    passed() { const t = step10(); if (!t.passMs) { t.passMs = Math.max(1, firstEditAt === null ? 1 : now() - firstEditAt); touch() } },
    outcome(kind: 'docs' | 'again') { step10().outcome = kind; touch() },
  }
}
