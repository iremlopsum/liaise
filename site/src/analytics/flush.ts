// When to send (spec §3): a hide sends if something changed and 30 s passed since the last send;
// pagehide sends if something changed; never more than CAPS.sends per page view.
import { CAPS } from './schema'
export const RESEND_MS = 30_000

export function createFlusher(o: { now: () => number; dirty: () => boolean; send: (seq: number) => void }) {
  let sends = 0, lastSend = -Infinity
  const go = () => { sends += 1; lastSend = o.now(); o.send(sends) }
  return {
    hidden() { if (sends < CAPS.sends && o.dirty() && o.now() - lastSend >= RESEND_MS) go() },
    pagehide() { if (sends < CAPS.sends && o.dirty()) go() },
  }
}
