// Facts about the page view, all derived without storing anything.
import { cleanTag } from './schema'

export function pagePath(pathname: string, base: string): string {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '')
  return '/' + rest
}
/** Another site: only its origin (that's all browsers send anyway). This site: the previous path.
 *  Sent on by the front page's redirect (`?via=front`): the origin it carried in `r`, or direct. */
export function fromOf(referrer: string, origin: string, base: string, search = ''): string {
  const q = new URLSearchParams(search), r = q.get('r') || ''
  if (q.get('via') === 'front') return /^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(r) ? r : ''
  if (!referrer) return ''
  try {
    const u = new URL(referrer)
    if (u.origin === origin) return pagePath(u.pathname, base)
    return u.origin
  } catch { return '' }
}
export function tagsOf(search: string): Record<string, string> {
  const q = new URLSearchParams(search), out: Record<string, string> = {}
  for (const k of ['ref', 'utm_source', 'utm_medium', 'utm_campaign']) { const v = q.get(k); if (v && cleanTag(v)) out[k] = cleanTag(v) }
  return out
}
export function randomId(): string {
  const a = new Uint8Array(12)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')
}
