// Bundle size of one JSON GET per library, measured the way scripts/size.mjs measures liaise:
// minified ESM, ES2020, tree-shaken, then gzip -9 and brotli. Unlike scripts/size.mjs
// (platform: 'neutral') this uses platform: 'browser' for every contender; the difference
// does not matter for liaise.
// Run `npm run build` at the repo root first (liaise resolves to ../dist).
import { build } from 'esbuild'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'

const entries = {
  fetch: `export default u => fetch(u).then(r => r.json())`,
  axios: `import axios from 'axios'; export default u => axios.get(u).then(r => r.data)`,
  ky: `import ky from 'ky'; export default u => ky.get(u).json()`,
  ofetch: `import { ofetch } from 'ofetch'; export default u => ofetch(u)`,
  liaise: `import { createApi, defineRequest } from 'liaise'; const api = createApi({ baseUrl: '', requests: { get: defineRequest()({ method: 'GET', path: '/x' }) } }); export default () => api.get()`,
  'liaise + retryMiddleware': `import { createApi, defineRequest } from 'liaise'; import { retryMiddleware } from 'liaise/middleware'; const api = createApi({ baseUrl: '', requests: { get: defineRequest()({ method: 'GET', path: '/x', middleware: [retryMiddleware({ max: 3 })] }) } }); export default () => api.get()`,
}

const sizes = {}
for (const [name, contents] of Object.entries(entries)) {
  const out = await build({
    stdin: { contents, resolveDir: import.meta.dirname, loader: 'js' },
    bundle: true, minify: true, format: 'esm', target: 'es2020', platform: 'browser', write: false,
  })
  const code = out.outputFiles[0].contents
  sizes[name] = { gzip: gzipSync(code, { level: 9 }).length, brotli: brotliCompressSync(code).length }
  console.log(`${name.padEnd(24)} ${sizes[name].gzip} B gzip  ${sizes[name].brotli} B brotli`)
}

const path = new URL('./results.json', import.meta.url)
const results = JSON.parse(readFileSync(path, 'utf8'))
results.sizes = sizes
writeFileSync(path, JSON.stringify(results, null, 2) + '\n')
