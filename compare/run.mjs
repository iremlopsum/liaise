import { existsSync, writeFileSync } from 'node:fs'
import { scenarios } from './scenarios.mjs'

if (!existsSync(new URL('../dist/index.js', import.meta.url))) {
  console.error('run `npm run build` in the repo root first (liaise is installed from ../dist)')
  process.exit(1)
}
const names = ['fetch', 'axios', 'ky', 'ofetch', 'liaise']
const contenders = await Promise.all(names.map(n => import(`./contenders/${n}.mjs`).then(m => m.default)))

const out = { meta: { date: new Date().toISOString().slice(0, 10), node: process.version, platform: `${process.platform} ${process.arch}`, versions: Object.fromEntries(contenders.map(c => [c.name, c.version])) }, scenarios: [] }
for (const s of scenarios) {
  process.stdout.write(`${s.title} … `)
  const results = {}
  await Promise.all(contenders.flatMap(c => ['default', 'configured'].map(async variant => {
    results[c.name] ??= { notes: c.variants.configured.notes, defaultNotes: c.variants.default.notes }
    results[c.name][variant] = await s.run(c.variants[variant])
  })))
  out.scenarios.push({ id: s.id, title: s.title, results })
  console.log('done')
}
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(out, null, 2) + '\n')
console.log('wrote compare/results.json')
