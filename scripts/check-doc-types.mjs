// Type-checks every TypeScript example in the docs that is not included from a test:
// ```ts blocks in README.md and site pages, and the playground's example files. A renamed option
// or a wrong call shape fails CI instead of shipping. A block that is deliberately not code (a
// type sketch, a fragment) is preceded by <!-- untyped: <reason> --> (in .mdx: {/* untyped: <reason> */}).
// The intro's files (site/src/intro/files.ts) are checked as one project too.
// Fences may be indented (list items) and carry meta strings (```ts title="x").
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const args = process.argv.slice(2)
const rootAt = args.indexOf('--root'), root = resolve(rootAt === -1 ? '.' : args[rootAt + 1])
const preludeAt = args.indexOf('--prelude')
const srcAt = args.indexOf('--src')
const introAt = args.indexOf('--intro')
const sources = srcAt === -1
  ? ['README.md', ...walk(join(root, 'site/src/content/docs'), /\.mdx?$/), ...walk(join(root, 'site/src/playground/examples'), /\.ts$/)].map(f => resolve(root, f))
  : args.slice(srcAt + 1).filter((a, i, all) => !a.startsWith('--') && !['--prelude', '--intro'].includes(all[i - 1]))

function walk(dir, re) { return existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).filter(f => re.test(f)).map(f => join(dir, f)) : [] }

const errors = [], snippets = []
let skipped = 0
for (const file of sources) {
  const text = readFileSync(file, 'utf8')
  if (file.endsWith('.ts')) { snippets.push({ file, line: 1, code: text }); continue }
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)```(?:ts|typescript)\b/.exec(lines[i])
    if (!open) continue
    const indent = open[1]
    const start = i + 1
    const closer = new RegExp(`^${indent}\`\`\`\\s*$`)
    let end = start; while (end < lines.length && !closer.test(lines[end])) end++
    const prev = lines.slice(Math.max(0, i - 3), i).join('\n')
    const marker = /<!--\s*untyped:\s*(.*?)\s*-->/.exec(prev) || /\{\/\*\s*untyped:\s*(.*?)\s*\*\/\}/.exec(prev)
    const included = /<!--\s*tested:/.test(prev)
    const code = lines.slice(start, end).map(l => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart())).join('\n')
    if (marker) { if (!marker[1]) errors.push(`${relative(root, file)}:${i + 1}: untyped marker needs a reason`); else skipped++ }
    else if (!included) snippets.push({ file, line: start + 1, code })
    i = end
  }
}

// The intro's files (site/src/intro/files.ts exports FILES: name → code) are one project of their
// own: they import each other ('./api', './session'), some are TSX, and the snippets' prelude
// (globals like `api` and `User`) must not leak into them. Without --src, the site's module is
// checked; with --src, only when --intro names one.
const introModule = introAt !== -1 ? resolve(args[introAt + 1]) : srcAt === -1 ? join(root, 'site/src/intro/files.ts') : null
const intro = []
if (introModule && existsSync(introModule)) {
  const { build } = await import('esbuild')
  const out = await build({ entryPoints: [introModule], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' })
  const { FILES } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
  for (const [name, code] of Object.entries(FILES)) intro.push({ name, code })
}

const tmp = mkdtempSync(join(tmpdir(), 'doc-types-'))
const prelude = preludeAt === -1 ? join(root, 'site/src/snippets/prelude.d.ts') : resolve(args[preludeAt + 1])
snippets.forEach((s, n) => writeFileSync(join(tmp, `s${n}.ts`), `/// <reference path="${prelude}" />\n${s.code}\nexport {}\n`))
for (const f of intro) { const p = join(tmp, 'intro', f.name); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, f.code) }

const BASE = {
  target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, skipLibCheck: false,
  lib: ['ES2022', 'DOM'], types: [], baseUrl: root,
  paths: { liaise: ['src/index.ts'], 'liaise/middleware': ['src/built-in-middleware.ts'], 'liaise/testing': ['src/testing.ts'] },
}
/** Runs tsc over `files` with `options` over BASE: [] when clean, else regex matches (or one raw string). */
function tsc(name, files, options = {}) {
  const config = join(tmp, `${name}.tsconfig.json`)
  writeFileSync(config, JSON.stringify({ compilerOptions: { ...BASE, ...options, paths: { ...BASE.paths, ...options.paths } }, files }))
  try {
    execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', config, '--pretty', 'false'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return []
  } catch (e) {
    const found = [...String(e.stdout).matchAll(/^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/gm)]
    return found.length ? found : [String(e.stdout) || String(e.stderr)]
  }
}

if (snippets.length) for (const m of tsc('snippets', snippets.map((_, n) => join(tmp, `s${n}.ts`)))) {
  if (typeof m === 'string') { errors.push(m); continue }
  const own = /s(\d+)\.ts$/.exec(m[1])
  if (own) { const s = snippets[+own[1]]; errors.push(`${relative(root, s.file)}:${s.line + Number(m[2]) - 2}: ${m[3]} ${m[4]}`) }
  else errors.push(`${relative(root, resolve(m[1]))}:${m[2]}: ${m[3]} ${m[4]}`)
}
if (intro.length) for (const m of tsc('intro', intro.map(f => join(tmp, 'intro', f.name)), {
  jsx: 'react-jsx',
  // tmp has no node_modules: point React (types only; it is the root's @types/react) at the root's.
  paths: { react: ['node_modules/@types/react/index.d.ts'], 'react/jsx-runtime': ['node_modules/@types/react/jsx-runtime.d.ts'] },
})) {
  if (typeof m === 'string') { errors.push(m); continue }
  const own = /[\\/]intro[\\/](.+)$/.exec(m[1])
  errors.push(own ? `${relative(root, introModule)} (${own[1]}):${m[2]}: ${m[3]} ${m[4]}` : `${relative(root, resolve(m[1]))}:${m[2]}: ${m[3]} ${m[4]}`)
}
rmSync(tmp, { recursive: true, force: true })
if (errors.length) { for (const e of errors) console.error(`docs:types: ${e}`); process.exit(1) }
const n = snippets.length
console.log(`docs:types: ${n} snippet${n === 1 ? '' : 's'} type-check${n === 1 ? 's' : ''}${intro.length ? `, ${intro.length} intro files` : ''}, ${skipped} skipped`)
