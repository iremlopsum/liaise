// Requests per second against the local test server, one contender at a time.
// Rounds are interleaved and the starting contender rotates, so run order does not favour anyone.
import { readFileSync, writeFileSync } from 'node:fs'
import { startServer } from './server.mjs'

const NOTE = 'localhost, keep-alive as each library defaults; a real network adds milliseconds per request, this measures microseconds'
const names = ['fetch', 'axios', 'ky', 'ofetch', 'liaise']
const RUNS = 10, CALLS = 2000, POOL = 50, WARMUP = 2000

const stats = runs => {
  const s = [...runs].sort((a, b) => a - b)
  const mid = s.length >> 1
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
  return { median: Math.round(median), min: Math.round(s[0]), max: Math.round(s[s.length - 1]) }
}

async function sequential(call) {
  const t = performance.now()
  for (let i = 0; i < CALLS; i++) await call()
  return CALLS / ((performance.now() - t) / 1000)
}
async function concurrent(call) {
  let next = 0
  const t = performance.now()
  await Promise.all(Array.from({ length: POOL }, async () => { while (next++ < CALLS) await call() }))
  return CALLS / ((performance.now() - t) / 1000)
}

const server = await startServer()
const overhead = {}
try {
  // Build every client first and warm every one up before any timing starts.
  const calls = {}
  for (const name of names) {
    const c = (await import(`./contenders/${name}.mjs`)).default
    const client = c.variants.default.create({ baseUrl: server.baseUrl, auth: { access: 'a1', refresh: 'r1' } })
    calls[name] = () => client.getJson('/s/ok')
  }
  for (const name of names) for (let i = 0; i < WARMUP; i++) await calls[name]()
  // 10 rounds; each round runs every contender once (sequential, then concurrent), one at a
  // time, rotating who goes first so no library always runs in the same slot.
  const seq = Object.fromEntries(names.map(n => [n, []])), con = Object.fromEntries(names.map(n => [n, []]))
  for (let round = 0; round < RUNS; round++) {
    for (let i = 0; i < names.length; i++) {
      const name = names[(round + i) % names.length]
      seq[name].push(await sequential(calls[name]))
      con[name].push(await concurrent(calls[name]))
    }
  }
  for (const name of names) {
    overhead[name] = { sequential: stats(seq[name]), concurrent: stats(con[name]) }
    console.log(name.padEnd(8), 'sequential', JSON.stringify(overhead[name].sequential), 'concurrent', JSON.stringify(overhead[name].concurrent))
  }
} finally { await server.close() }

console.log(NOTE)
const path = new URL('./results.json', import.meta.url)
const results = JSON.parse(readFileSync(path, 'utf8'))
results.overhead = overhead
results.meta.overheadNote = NOTE
writeFileSync(path, JSON.stringify(results, null, 2) + '\n')
