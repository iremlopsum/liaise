// Engaged time: time the page is visible and had input (or a playing intro slide) in the last 15 s.
// Measured lazily from timestamps, so no timer runs.
export const IDLE_MS = 15_000

export function createEngagement(now: () => number) {
  let lastInput = now(), visible = true, last = now(), total = 0
  function tick() {
    const t = now()
    if (visible) { const to = Math.min(t, lastInput + IDLE_MS); if (to > last) total += to - last }
    last = t
  }
  return {
    input() { tick(); lastInput = now() },
    setVisible(v: boolean) { tick(); visible = v },
    get ms() { tick(); return total },
  }
}
