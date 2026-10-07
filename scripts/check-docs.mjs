// Two checks that keep README.md honest:
//
// 1. Every code block marked `<!-- tested: name -->` must equal the region
//    `// example:name:start` … `// example:name:end` in some tests/**/*.test.ts,
//    so an example cannot drift from code CI actually runs.
// 2. Every in-page link `](#anchor)` must point at a heading that exists,
//    using GitHub's anchor rules. Reordering the README renames headings, and a
//    dead anchor fails silently on GitHub and npm.
//
// 3. Site pages include regions with <Example name="…" />; each must name a real region, and every
//    region must be used by the README or a page.
//
// Usage: node scripts/check-docs.mjs [--readme README.md] [--tests tests] [--site site/src/content/docs]
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { normalize, findRegions } from './examples.mjs'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}
const readmePath = opt('--readme', 'README.md')
const testsDir = opt('--tests', 'tests')

/** Markdown with fenced code blocks blanked out, so their contents are not read as links or headings. */
function withoutCode(text) {
  return text.replace(/^```[\s\S]*?^```/gm, m => m.replace(/[^\n]/g, ' '))
}

function readmeBlocks(text, errors) {
  const blocks = new Map()
  const re = /<!--\s*tested:\s*([a-z0-9-]+)\s*-->[ \t]*\n(?:[ \t]*\n)*```[a-z]*\n([\s\S]*?)\n```/g
  for (const m of text.matchAll(re)) {
    if (blocks.has(m[1])) errors.push(`README marks "${m[1]}" more than once`)
    blocks.set(m[1], normalize(m[2]))
  }
  for (const m of text.matchAll(/<!--\s*tested:\s*([a-z0-9-]+)\s*-->/g)) {
    if (!blocks.has(m[1])) errors.push(`README marker "${m[1]}" is not followed by a code block`)
  }
  return blocks
}

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens, -1/-2 for repeats. */
function anchors(text) {
  const seen = new Map()
  const out = new Set()
  for (const m of withoutCode(text).matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)) {
    const base = m[1]
      .replace(/<[^>]+>/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/ /g, '-')
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    out.add(n === 0 ? base : `${base}-${n}`)
  }
  return out
}

function firstDifference(a, b) {
  const x = a.split('\n'), y = b.split('\n')
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return { line: i + 1, readme: x[i] ?? '(end of block)', test: y[i] ?? '(end of region)' }
  }
  return null
}

const errors = []
const readme = readFileSync(readmePath, 'utf8')
const blocks = readmeBlocks(readme, errors)
const { regions, errors: regionErrors } = findRegions(testsDir)
errors.push(...regionErrors)

for (const [name, code] of blocks) {
  const region = regions.get(name)
  if (!region) { errors.push(`README block "${name}" has no test region (// example:${name}:start)`); continue }
  const diff = firstDifference(code, region.code)
  if (diff) errors.push(`README block "${name}" differs from ${region.file} at line ${diff.line}:\n  README: ${diff.readme}\n  test:   ${diff.test}`)
}
// Site pages include regions by name: <Example name="…" />.
const siteDir = opt('--site', 'site/src/content/docs')
const included = new Map() // name -> page
let includes = 0
if (existsSync(siteDir)) {
  for (const f of readdirSync(siteDir, { recursive: true }).map(String).filter(f => /\.mdx?$/.test(f))) {
    const text = readFileSync(join(siteDir, f), 'utf8')
    for (const m of text.matchAll(/<Example\s+name="([a-z0-9-]+)"\s*\/>/g)) {
      includes++
      if (!regions.has(m[1])) errors.push(`${f}: <Example name="${m[1]}"> has no test region (// example:${m[1]}:start)`)
      included.set(m[1], f)
    }
  }
}
for (const [name, region] of regions) {
  if (!blocks.has(name) && !included.has(name)) errors.push(`test region "${name}" (${region.file}) is used by neither the README nor a page`)
}

const known = anchors(readme)
let links = 0
for (const m of withoutCode(readme).matchAll(/\]\(#([^)\s]+)\)/g)) {
  links++
  if (!known.has(m[1])) errors.push(`link to #${m[1]} points at no heading`)
}

if (errors.length) {
  for (const e of errors) console.error(`docs:check: ${e}`)
  process.exit(1)
}
console.log(`docs:check: ${blocks.size} tested blocks match, ${includes} site include${includes === 1 ? '' : 's'}, ${links} links resolve`)
