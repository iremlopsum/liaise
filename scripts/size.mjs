// Measures what liaise costs a consumer: each entry bundled the way an app
// would (minified ESM, ES2020, tree-shaken), then gzip -9 and brotli.
// Before 5.0.1 the README's numbers were set once by hand and went stale for
// fifteen releases; CI now runs this and fails when a budget is exceeded.
// Run after `npm run build` (it measures dist/).
import { build } from 'esbuild'
import { gzipSync, brotliCompressSync } from 'node:zlib'

const entries = {
  'REST only': `import { createApi, Request, defineRequest } from './dist/index.js'; console.log(createApi, Request, defineRequest)`,
  'core + polling': `import { createApi, defineRequest, poll, pollUntil } from './dist/index.js'; console.log(createApi, defineRequest, poll, pollUntil)`,
  'core entry': `export * from './dist/index.js'`,
  'core + middleware': `export * from './dist/index.js'; export * from './dist/built-in-middleware.js'`,
}

// Gzip budgets in bytes, about 10% above the measured value. Raising one is a
// deliberate edit in the same PR as the growth.
// 5.1.0 raised all three: sharing on what is sent moved into core (GraphQL share,
// the wire-key, per-caller pipelines) and the logger moved into core (the `log`
// option on both clients; logMiddleware now shares it).
// Polling raised the last two and added its own row: poll and pollUntil, with the
// stableKey and Retry-After helpers they bring into core (core entry 7782 → 10276 B,
// core + middleware 9443 → 11269 B, core + polling 8850 B). REST only is unchanged.
const budgets = { 'REST only': 7000, 'core + polling': 9740, 'core entry': 11300, 'core + middleware': 12400 }

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
