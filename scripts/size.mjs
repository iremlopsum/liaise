// Measures what liaise costs a consumer: each entry bundled the way an app
// would (minified ESM, ES2020, tree-shaken), then gzip -9 and brotli.
// Before 5.0.1 the README's numbers were set once by hand and went stale for
// fifteen releases; CI now runs this and fails when a budget is exceeded.
// Run after `npm run build` (it measures dist/).
import { build } from 'esbuild'
import { gzipSync, brotliCompressSync } from 'node:zlib'

const entries = {
  'REST only': `import { createApi, Request, defineRequest } from './dist/index.js'; console.log(createApi, Request, defineRequest)`,
  'core entry': `export * from './dist/index.js'`,
  'core + middleware': `export * from './dist/index.js'; export * from './dist/built-in-middleware.js'`,
}

// Gzip budgets in bytes, about 10% above the measured value. Raising one is a
// deliberate edit in the same PR as the growth.
const budgets = { 'REST only': 6233, 'core entry': 7453, 'core + middleware': 8576 }

let failed = false
for (const [name, contents] of Object.entries(entries)) {
  const out = await build({
    stdin: { contents, resolveDir: process.cwd(), loader: 'js' },
    bundle: true, minify: true, format: 'esm', target: 'es2020', write: false, platform: 'neutral',
  })
  const code = out.outputFiles[0].contents
  const gz = gzipSync(code, { level: 9 }).length
  const br = brotliCompressSync(code).length
  const over = budgets[name] > 0 && gz > budgets[name]
  if (over) failed = true
  console.log(`${name.padEnd(18)} ${gz} B  ${(gz / 1024).toFixed(1)} kB gzip  ${(br / 1024).toFixed(1)} kB brotli${over ? `  OVER BUDGET (${budgets[name]} B)` : ''}`)
}
if (failed) process.exit(1)
