// Turns results.json into results.md. The docs site's /compare page reads results.json itself
// (through cells.mjs); the README no longer carries the tables.
import { readFileSync, writeFileSync } from 'node:fs'
import { NAMES as names, OVERHEAD, cell } from './cells.mjs'

// Absolute, so links into compare/ also work on npm, which doesn't ship compare/.
const REPO = 'https://github.com/iremlopsum/liaise/blob/main/compare'

const results = JSON.parse(readFileSync(new URL('./results.json', import.meta.url), 'utf8'))
const esc = s => String(s).replaceAll('|', '\\|')
const table = (head, rows) => [`| ${head.map(esc).join(' | ')} |`, `| ${head.map((_, i) => (i ? ':--' : '---')).join(' | ')} |`, ...rows.map(r => `| ${r.map(esc).join(' | ')} |`)].join('\n')
// The table marks a cell that needed hand-written code with `*`.
const cellText = (s, name, variant) => { const c = cell(s, name, variant); return c.text + (c.kind === 'code' ? '*' : '') }
const outcomes = variant => table(['Scenario', ...names], results.scenarios.map(s => [s.title, ...names.map(n => cellText(s, n, variant))]))

const kb = b => (b / 1024).toFixed(1)
const sizeNames = [...names, 'liaise + retryMiddleware']
const sizeTable = () => table(['Library', 'gzip (kB)', 'brotli (kB)'], sizeNames.map(n => [n, kb(results.sizes[n].gzip), kb(results.sizes[n].brotli)]))

const fmt = x => `${x.median.toLocaleString('en-US')} (${x.min.toLocaleString('en-US')}–${x.max.toLocaleString('en-US')})`
const overheadTable = () => table(['Library', 'Sequential', `Concurrent (${OVERHEAD.inFlight} in flight)`], names.map(n => [n, fmt(results.overhead[n].sequential), fmt(results.overhead[n].concurrent)]))

function notesSection() {
  const out = []
  for (const n of names) {
    const first = results.scenarios[0].results[n]
    out.push(`### ${n}`, '')
    for (const [m, t] of Object.entries(first.notes)) out.push(`- ${m}: ${t}`)
    for (const [m, t] of Object.entries(first.defaultNotes ?? {})) out.push(`- ${m} (out of the box): ${t}`)
    out.push('')
  }
  return out.join('\n')
}

const { meta } = results
const versions = names.map(n => `${n} ${meta.versions[n]}`).join(', ')
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const readableDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${months[m - 1]} ${y}` }
// The owner's disclaimer: the comparison is a dated snapshot of other people's libraries.
const contenders = names.filter(n => n !== 'fetch' && n !== 'liaise').map(n => `${n} ${meta.versions[n]}`)
const contenderList = contenders.length > 1 ? `${contenders.slice(0, -1).join(', ')} and ${contenders.at(-1)}` : contenders.join('')
const disclaimer = `Measured on ${readableDate(meta.date)} against ${contenderList}. Other libraries change. Rerun it with \`npm run build\` in the repo root, then \`npm install && npm run compare\` in \`compare/\`.`
// Every scenario runs in Node; in a browser axios switches to its XHR adapter.
const axiosNote = 'In browsers axios uses XHR, so its results there can differ.'
const full = `# Comparison results

${disclaimer}

Run on ${meta.date}, Node ${meta.node}, ${meta.platform}, against a local server. Versions: ${versions}. ${axiosNote}

## Table A. With each library's documented setup

${outcomes('configured')}

\\* needed hand-written code, described in the notes.
\`—\` means the library has no built-in option for that scenario. Milliseconds are shown only where timing is the point.

## Table B. Out of the box

${outcomes('default')}

\\* needed hand-written code, described in the notes.

Reading guide: a 204 and a slow server are normal. An error, or still waiting, in those rows is a failure.

## Table C. Size

One JSON GET, minified ES2020 ESM bundle for a browser.

${sizeTable()}

fetch is built into the runtime; its row is the call site only, the floor rather than a library.

## Table D. Requests per second on localhost

Median (min–max) of ${OVERHEAD.rounds} interleaved rounds of ${OVERHEAD.calls.toLocaleString('en-US')} calls each, after ${OVERHEAD.warmup.toLocaleString('en-US')} warm-up calls per library. ${meta.overheadNote}. Differences under about ${OVERHEAD.noise * 100}% are noise.

${overheadTable()}

## Notes

${notesSection()}`

writeFileSync(new URL('./results.md', import.meta.url), full)
console.log('wrote compare/results.md')
