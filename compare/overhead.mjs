// Requests per second against the local test server, one contender at a time.
import { readFileSync, writeFileSync } from 'node:fs'
import { startServer } from './server.mjs'

const NOTE = 'localhost, keep-alive as each library defaults; a real network adds milliseconds per request, this measures microseconds'
const names = ['fetch', 'axios', 'ky', 'ofetch', 'liaise']
const RUNS = 10, CALLS = 2000, POOL = 50

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
  for (const name of names) {
    const c = (await import(`./contenders/${name}.mjs`)).default
    const client = c.variants.default.create({ baseUrl: server.baseUrl, auth: { access: 'a1', refresh: 'r1' } })
    const call = () => client.getJson('/s/ok')
    for (let i = 0; i < 300; i++) await call()
    const seq = [], con = []
    for (let i = 0; i < RUNS; i++) seq.push(await sequential(call))
    for (let i = 0; i < RUNS; i++) con.push(await concurrent(call))
    overhead[name] = { sequential: stats(seq), concurrent: stats(con) }
    console.log(name.padEnd(8), 'sequential', JSON.stringify(overhead[name].sequential), 'concurrent', JSON.stringify(overhead[name].concurrent))
  }
} finally { await server.close() }

console.log(NOTE)
const path = new URL('./results.json', import.meta.url)
const results = JSON.parse(readFileSync(path, 'utf8'))
results.overhead = overhead
results.meta.overheadNote = NOTE
writeFileSync(path, JSON.stringify(results, null, 2) + '\n')
