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
  'core + pager': `import { createApi, defineRequest, createPager } from './dist/index.js'; console.log(createApi, defineRequest, createPager)`,
  'core entry': `export * from './dist/index.js'`,
  'core + middleware': `export * from './dist/index.js'; export * from './dist/built-in-middleware.js'`,
}

// Gzip budgets in bytes, about 5-10% above the measured value. Raising one is a
// deliberate edit in the same PR as the growth.
// 5.1.0 raised all three: sharing on what is sent moved into core (GraphQL share,
// the wire-key, per-caller pipelines) and the logger moved into core (the `log`
// option on both clients; logMiddleware now shares it).
// Polling raised the last two and added its own row: poll and pollUntil, with the
// stableKey and Retry-After helpers they bring into core (core entry 7782 → 10276 B,
// core + middleware 9443 → 11269 B, core + polling 8850 B). REST only is unchanged.
// 5.3.0 raised REST only, core entry and core + middleware: withHeaders' copy state
// and the endpoint loop as a function (build / buildSide) are in every client, used or not
// (measured at 5.3.0: REST only 6966 → 7125 B, core + polling 9415 → 9612 B, core entry
// 10887 → 11544 B, core + middleware 12239 → 12879 B; core + polling stays within its budget).
// 5.4.0 added createPager (numbered, cursor and list pagers with a subscribable state) to the
// core entry, with its own row. It is tree-shaken out of everything that doesn't import it
// (REST only 7153 B and core + polling 9650 B are unchanged), and costs 10089 - 7153 = 2936 B
// over a REST client. Raised: core entry 11677 → 14007 B (budget 12100 → 14900), core +
// middleware 13011 → 15366 B (13500 → 16300). core + pager is new, at 10089 B.
// 5.5.0 (piece 1, query or mutation): error.request.name on both clients, poll's recorder
// keeping the name and operation type, and the flat client's document reader in the core
// entry, retry and cache skipping mutations, and the per-type GraphQL timeout (measured:
// REST only 7153 → 7208 B, core + polling 9650 → 9743 B, core + pager 10089 → 10141 B,
// core entry 14007 → 14574 B, core + middleware 15366 → 16002 B). Raised: core + polling
// 9740 → 10250.
const budgets = { 'REST only': 7700, 'core + polling': 10250, 'core + pager': 10700, 'core entry': 14900, 'core + middleware': 16300 }

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
