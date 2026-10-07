// Reads the structure of CHANGELOG.md: the version headings
// ("## [5.1.0] — 2026-10-04") and the link definitions at the bottom
// ("[5.1.0]: https://…"). Shared by release-check.mjs and release-notes.mjs, so
// the release PR check and the release itself read the file the same way.

const HEADING = /^## \[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\] — (\d{4}-\d{2}-\d{2})\s*$/
const LINK_DEFINITION = /^\[[^\]]+\]: \S/

/** Every version heading, newest first: { version, date, line } with a 0-based line. */
export function headings(text) {
  const out = []
  text.split('\n').forEach((line, i) => {
    const m = HEADING.exec(line)
    if (m) out.push({ version: m[1], date: m[2], line: i })
  })
  return out
}

/** The URL of a version's link definition ("[5.1.0]: url"), or null when there is none. */
export function footerFor(text, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`^\\[${escaped}\\]: (\\S+)\\s*$`, 'm').exec(text)
  return m ? m[1] : null
}

/**
 * A version's section without its heading: up to the next "## " heading or the
 * first link definition, outer blank lines removed. null when the heading is missing.
 */
export function sectionBody(text, version) {
  const lines = text.split('\n')
  const start = lines.findIndex(l => l.startsWith(`## [${version}] `))
  if (start === -1) return null
  let end = start + 1
  while (end < lines.length && !lines[end].startsWith('## ') && !LINK_DEFINITION.test(lines[end])) end++
  const body = lines.slice(start + 1, end)
  while (body.length && body[0].trim() === '') body.shift()
  while (body.length && body[body.length - 1].trim() === '') body.pop()
  return body.join('\n') + '\n'
}
