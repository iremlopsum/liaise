// Copies the library build (../dist) into public/liaise so the playground can run it and load
// its types. Run by predev/prebuild; the repo's `npm run build` must have run first.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const from = new URL('../../dist/', import.meta.url).pathname
const to = new URL('../public/liaise/', import.meta.url).pathname
if (!existsSync(join(from, 'index.js'))) {
  console.error('copy-liaise: ../dist/index.js is missing — run `npm run build` in the repo root first')
  process.exit(1)
}
rmSync(to, { recursive: true, force: true }); mkdirSync(to, { recursive: true })
cpSync(from, to, { recursive: true, filter: f => statSync(f).isDirectory() || /\.(js|d\.ts)$/.test(f) })
const dts = []
const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : p.endsWith('.d.ts') && dts.push(relative(to, p)) } }
walk(to)
writeFileSync(join(to, 'dts.json'), JSON.stringify(dts.sort()))
console.log(`copy-liaise: ${dts.length} type files`)
