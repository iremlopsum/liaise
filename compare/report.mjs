// Turns results.json into results.md, and with `--splice <readme>` into the README's comparison block.
import { readFileSync, writeFileSync } from 'node:fs'

// Absolute, so links into compare/ also work on npm, which doesn't ship compare/.
const REPO = 'https://github.com/iremlopsum/liaise/blob/main/compare'
const START = '<!-- compare:start -->', END = '<!-- compare:end -->'
const names = ['fetch', 'axios', 'ky', 'ofetch', 'liaise']
const methodFor = { 'http-500': 'getJson', offline: 'getJson', hang: 'getJson', 'broken-json': 'getJson', 'empty-204': 'getJson',
  'missing-param': 'getUser', 'search-race': 'search', 'refresh-stampede': 'getWithAuth', deadline: 'getWithDeadline', 'wrong-shape': 'getValidated' }
const timingRows = new Set(['hang', 'deadline'])

const results = JSON.parse(readFileSync(new URL('./results.json', import.meta.url), 'utf8'))
const esc = s => String(s).replaceAll('|', '\\|')
const table = (head, rows) => [`| ${head.map(esc).join(' | ')} |`, `| ${head.map((_, i) => (i ? ':--' : '---')).join(' | ')} |`, ...rows.map(r => `| ${r.map(esc).join(' | ')} |`)].join('\n')
const handWritten = n => typeof n === 'string' && /\bhand-written\b/.test(n)

function cell(s, name, variant) {
  const r = s.results[name]
  const res = r[variant]
  const notes = variant === 'configured' ? r.notes : r.defaultNotes
  let text = res.outcome
  if (timingRows.has(s.id) && res.outcome !== '—' && !/ after \d/.test(` ${res.outcome}`)) text += `, ${res.ms} ms`
  return text + (handWritten(notes?.[methodFor[s.id]]) ? '*' : '')
}
const outcomes = variant => table(['Scenario', ...names], results.scenarios.map(s => [s.title, ...names.map(n => cell(s, n, variant))]))

const kb = b => (b / 1024).toFixed(1)
const sizeNames = [...names, 'liaise + retryMiddleware']
const sizeTable = () => table(['Library', 'gzip (kB)', 'brotli (kB)'], sizeNames.map(n => [n, kb(results.sizes[n].gzip), kb(results.sizes[n].brotli)]))

// A sentence about liaise's out-of-the-box failures in the hang and 204 rows, from results.json.
function liaiseDefaultSentence() {
  const row = id => results.scenarios.find(s => s.id === id).results.liaise.default.outcome
  const hang = row('hang'), empty = row('empty-204')
  const hangBad = /^still waiting/.test(hang), emptyBad = /^(throws|error result)/.test(empty)
  const others = names.filter(n => n !== 'liaise' && /^throws/.test(results.scenarios.find(s => s.id === 'hang').results[n].default.outcome))
  const parts = []
  if (hangBad) parts.push(`has no timeout (${others.length ? `only ${others.join(' and ')} ${others.length === 1 ? 'has one' : 'have one'} by default` : 'no library here has one by default'})`)
  if (emptyBad) parts.push(`treats a 204 on a JSON call as ${/parse/.test(empty) ? 'a parse error' : 'an error'}`)
  if (!parts.length) return `Out of the box, liaise handles the hang and 204 rows without a failure. See Table B in [compare/results.md](${REPO}/results.md).`
  return `Out of the box, liaise ${parts.join(' and ')}. See Table B in [compare/results.md](${REPO}/results.md).`
}
const fmt = x => `${x.median.toLocaleString('en-US')} (${x.min.toLocaleString('en-US')}–${x.max.toLocaleString('en-US')})`
const overheadTable = () => table(['Library', 'Sequential', 'Concurrent (50 in flight)'], names.map(n => [n, fmt(results.overhead[n].sequential), fmt(results.overhead[n].concurrent)]))
const overheadLine = () => `Request overhead on localhost, sequential (median requests per second): ${names.map(n => `${n} ${results.overhead[n].sequential.median.toLocaleString('en-US')}`).join(', ')}.`

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
const full = `# Comparison results

${disclaimer}

Run on ${meta.date}, Node ${meta.node}, ${meta.platform}. Versions: ${versions}.

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

Median (min–max) of 10 interleaved rounds of 2,000 calls each, after 2,000 warm-up calls per library. ${meta.overheadNote}. Differences under about 5% are noise.

${overheadTable()}

## Notes

${notesSection()}`

if (process.argv[2] === '--splice') {
  const file = process.argv[3]
  if (!file) { console.error('usage: report.mjs --splice <readme>'); process.exit(1) }
  const readme = readFileSync(file, 'utf8')
  const a = readme.indexOf(START), b = readme.indexOf(END)
  if (a === -1 || b === -1 || b < a) { console.error(`${file}: missing ${START} / ${END} markers`); process.exit(1) }
  const block = `${START}

${disclaimer}

${outcomes('configured')}

\\* needed hand-written code, described in the [notes](${REPO}/results.md#notes). — means the library has no built-in option.

${liaiseDefaultSentence()}

${sizeTable()}

fetch is built into the runtime; its row is the call site only, the floor rather than a library.

${overheadLine()}

Out-of-the-box results, request overhead in full and the notes: [compare/results.md](${REPO}/results.md).

`
  writeFileSync(file, readme.slice(0, a) + block + readme.slice(b))
  console.log(`spliced into ${file}`)
} else {
  writeFileSync(new URL('./results.md', import.meta.url), full)
  console.log('wrote compare/results.md')
}
