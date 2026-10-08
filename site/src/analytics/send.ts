// How a record reaches Firestore: one REST commit that creates pv/<pv>-<seq> and has the server set
// `at` to its own time (firestore.rules insists on that, so no visitor can backdate a record). It
// never throws: analytics failing must never touch the page.
import { encodeRecord, toFields, type PageRecord, type Wire } from './schema'

export const commitUrl = (projectId: string, apiKey: string, origin = 'https://firestore.googleapis.com') =>
  `${origin}/v1/projects/${projectId}/databases/(default)/documents:commit?key=${encodeURIComponent(apiKey)}`

export function wireBody(projectId: string, w: Wire, opts: { at?: string } = {}): string {
  const name = `projects/${projectId}/databases/(default)/documents/pv/${w.pv}-${w.seq}`
  const fields = toFields(w)
  const write: Record<string, unknown> = { update: { name, fields }, currentDocument: { exists: false } }
  if (opts.at) (fields as Record<string, unknown>).at = { timestampValue: opts.at }
  else write.updateTransforms = [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }]
  return JSON.stringify({ writes: [write] })
}

export const commitBody = (projectId: string, r: PageRecord) => wireBody(projectId, encodeRecord(r))

export function post(url: string, body: string, fetchFn: typeof fetch = globalThis.fetch): void {
  try {
    void fetchFn(url, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body }).catch(() => {})
  } catch { /* no fetch, or it threw synchronously: drop the record */ }
}
