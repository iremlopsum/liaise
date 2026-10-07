// Type-checks every TypeScript example in the docs that is not included from a test:
// ```ts blocks in README.md and site pages, and the playground's example files. A renamed option
// or a wrong call shape fails CI instead of shipping. A block that is deliberately not code (a
// type sketch, a fragment) is preceded by <!-- untyped: <reason> -->.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const args = process.argv.slice(2)
const rootAt = args.indexOf('--root'), root = resolve(rootAt === -1 ? '.' : args[rootAt + 1])
const srcAt = args.indexOf('--src')
const sources = srcAt === -1
  ? ['README.md', ...walk(join(root, 'site/src/content/docs'), /\.mdx?$/), ...walk(join(root, 'site/src/playground/examples'), /\.ts$/)].map(f => resolve(root, f))
  : args.slice(srcAt + 1).filter(a => !a.startsWith('--'))

function walk(dir, re) { return existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).filter(f => re.test(f)).map(f => join(dir, f)) : [] }

const errors = [], snippets = []
let skipped = 0
for (const file of sources) {
  const text = readFileSync(file, 'utf8')
  if (file.endsWith('.ts')) { snippets.push({ file, line: 1, code: text }); continue }
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/^```ts\s*$/.test(lines[i])) continue
    const start = i + 1
    let end = start; while (end < lines.length && !/^```\s*$/.test(lines[end])) end++
    const prev = lines.slice(Math.max(0, i - 3), i).join('\n')
    const marker = /<!--\s*untyped:\s*(.*?)\s*-->/.exec(prev)
    const included = /<!--\s*tested:/.test(prev)
    if (marker) { if (!marker[1]) errors.push(`${relative(root, file)}:${i + 1}: untyped marker needs a reason`); else skipped++ }
    else if (!included) snippets.push({ file, line: start + 1, code: lines.slice(start, end).join('\n') })
    i = end
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'doc-types-'))
const prelude = join(root, 'site/src/snippets/prelude.d.ts')
snippets.forEach((s, n) => writeFileSync(join(tmp, `s${n}.ts`), `/// <reference path="${prelude}" />\n${s.code}\nexport {}\n`))
writeFileSync(join(tmp, 'tsconfig.json'), JSON.stringify({
  compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, skipLibCheck: true,
    lib: ['ES2022', 'DOM'], types: [], baseUrl: root,
    paths: { liaise: ['src/index.ts'], 'liaise/middleware': ['src/built-in-middleware.ts'], 'liaise/testing': ['src/testing.ts'] },
  },
  files: [...snippets.map((_, n) => join(tmp, `s${n}.ts`))],
}))
if (snippets.length) {
  try {
    execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', join(tmp, 'tsconfig.json'), '--pretty', 'false'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    for (const m of String(e.stdout).matchAll(/s(\d+)\.ts\((\d+),\d+\): error (TS\d+): (.*)/g)) {
      const s = snippets[+m[1]]
      errors.push(`${relative(root, s.file)}:${s.line + Number(m[2]) - 2}: ${m[3]} ${m[4]}`)
    }
    if (!errors.length) errors.push(String(e.stdout) || String(e.stderr))
  }
}
rmSync(tmp, { recursive: true, force: true })
if (errors.length) { for (const e of errors) console.error(`docs:types: ${e}`); process.exit(1) }
console.log(`docs:types: ${snippets.length} snippet${snippets.length === 1 ? '' : 's'} type-check${snippets.length === 1 ? 's' : ''}, ${skipped} skipped`)
