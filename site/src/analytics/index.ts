// The collector in the page (spec §3): decides whether to run at all, builds the record from what
// the page does, and sends it when the tab is hidden or closed. Other modules call `analytics.*`;
// when the collector is off (another host, GPC, an automated or bot browser), every call is a no-op.
// It never touches cookies or browser storage, and nothing here may throw into the page.
import { FIREBASE, COLLECT_HOSTS } from './config'
import { createRecorder, type Recorder } from './recorder'
import { createEngagement } from './engaged'
import { createFlusher } from './flush'
import { commitUrl, commitBody, post } from './send'
import { BOT, browserOf, osOf, deviceOf } from './ua'
import { pagePath, fromOf, tagsOf, randomId } from './page'

export { pagePath }

/** 'host:port' of a local Firestore emulator. Set only for the browser checks' builds. */
const EMULATOR = import.meta.env.PUBLIC_ANALYTICS_EMULATOR as string | undefined
const PROJECT = EMULATOR ? 'demo-liaise-analytics' : FIREBASE.projectId
const BASE = import.meta.env.BASE_URL

type Methods = Omit<Recorder, 'dirty' | 'snapshot' | 'visibility'>
export type Analytics = Methods & { input(): void }

function enabled(): boolean {
  try {
    if ((navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl) return false
    if (EMULATOR) return true
    if (navigator.webdriver || BOT.test(navigator.userAgent)) return false
    return COLLECT_HOSTS.includes(location.hostname)
  } catch { return false }
}

function safe<T extends object>(target: T): T {
  // Every method swallows its own errors: analytics never breaks the page.
  return new Proxy(target, { get: (t, k) => { const v = Reflect.get(t, k); return typeof v === 'function' ? (...a: unknown[]) => { try { return v.apply(t, a) } catch { /* ignore */ } } : v } })
}

/** A listener of ours never throws into the page. */
const guard = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => { try { fn(...a) } catch { /* ignore */ } }

function start(): Analytics {
  const url = commitUrl(PROJECT, FIREBASE.apiKey, EMULATOR ? `http://${EMULATOR}` : undefined)
  const now = () => Date.now()
  const ua = navigator.userAgent
  const facts = () => ({
    pv: randomId(), path: pagePath(location.pathname, BASE), tags: tagsOf(location.search),
    from: fromOf(document.referrer, location.origin, BASE), tz: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    lang: (navigator.language || '').toLowerCase(), browser: browserOf(ua), os: osOf(ua),
    device: deviceOf(innerWidth, ua, matchMedia('(pointer: coarse)').matches),
  })
  const seen = () => document.visibilityState !== 'hidden'
  let rec = createRecorder(facts(), now, seen())
  let eng = createEngagement(now, seen())
  let flusher = makeFlusher()
  function makeFlusher() {
    // The handlers that call this run outside the safe proxy, and commitBody can throw.
    return createFlusher({ now, dirty: () => rec.dirty, send: (seq) => { try { post(url, commitBody(PROJECT, rec.snapshot(seq, eng.ms))) } catch { /* never into the page */ } } })
  }

  const onInput = guard(() => eng.input())
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart']) addEventListener(ev, onInput, { passive: true, capture: true })
  document.addEventListener('visibilitychange', guard(() => {
    const shown = document.visibilityState === 'visible'
    eng.setVisible(shown); rec.visibility(shown)
    if (!shown) { settle(); flusher.hidden() }
  }))
  addEventListener('pagehide', guard(() => { settle(); flusher.pagehide() }))
  // A page restored from the back/forward cache is a new page view.
  addEventListener('pageshow', guard((e: Event) => {
    if ((e as PageTransitionEvent).persisted) { rec = createRecorder(facts(), now, seen()); eng = createEngagement(now, seen()); flusher = makeFlusher(); pending = settled = '' }
  }))

  // Links: own pages mean "not an exit"; GitHub, npm and Compare are counted. A link that only
  // changes the #hash is the page's own table of contents, not navigation.
  document.addEventListener('click', guard((e: Event) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a || typeof a.href !== 'string') return
    const u = new URL(a.href, location.href)
    if (u.origin === location.origin && u.pathname.startsWith(BASE)) {
      if (u.pathname === location.pathname && u.search === location.search) return
      rec.internalLink()
      if (pagePath(u.pathname, BASE).startsWith('/compare/')) rec.out('compare')
    } else if (u.hostname === 'github.com') rec.out('github')
    else if (u.hostname === 'npmjs.com' || u.hostname === 'www.npmjs.com') rec.out('npm')
  }), { capture: true })

  // Search (the dialog in Base.astro): a query counts once the reader stops typing for 1 s, or picks
  // a result, or closes the dialog or the page.
  let pending = '', settled = '', timer: ReturnType<typeof setTimeout> | undefined
  const results = () => document.querySelectorAll('#search-results > li > a').length
  function settle() { clearTimeout(timer); const q = pending.trim(); if (q && q !== settled) { settled = q; rec.search(q, results(), null) } }
  const pick = (a: Element | null | undefined) => {
    if (!a) return
    settle()
    rec.searchClick(pending.trim(), [...document.querySelectorAll('#search-results a')].indexOf(a) + 1)
    rec.internalLink()
  }
  document.addEventListener('input', guard((e: Event) => {
    if ((e.target as Element | null)?.id !== 'search-input') return
    pending = (e.target as HTMLInputElement).value
    clearTimeout(timer); timer = setTimeout(guard(settle), 1000)
  }))
  document.addEventListener('click', guard((e: Event) => pick((e.target as Element | null)?.closest?.('#search-results a'))), { capture: true })
  // Enter picks the highlighted result (Base.astro navigates with location.href, no click).
  document.getElementById('search-input')?.addEventListener('keydown', guard((e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter') pick(document.querySelector('#search-results a[data-active="true"]'))
  }), { capture: true })
  document.getElementById('search')?.addEventListener('close', guard(settle))

  const api = { input: () => eng.input() } as Analytics
  for (const k of Object.keys(rec) as Array<keyof Recorder>) {
    if (k === 'dirty' || k === 'snapshot' || k === 'visibility') continue
    ;(api as unknown as Record<string, unknown>)[k] = (...a: unknown[]) => (rec[k] as (...x: unknown[]) => unknown)(...a)
  }
  return api
}

const NOOP = new Proxy({}, { get: () => () => {} }) as Analytics
let instance: Analytics = NOOP
try { if (enabled()) instance = safe(start()) } catch { instance = NOOP }
export const analytics: Analytics = instance
