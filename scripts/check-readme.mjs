// Two checks that keep README.md honest:
//
// 1. Every code block marked `<!-- tested: name -->` must equal the region
//    `// readme:name:start` … `// readme:name:end` in some tests/**/*.test.ts,
//    so an example cannot drift from code CI actually runs.
// 2. Every in-page link `](#anchor)` must point at a heading that exists,
//    using GitHub's anchor rules. Reordering the README renames headings, and a
//    dead anchor fails silently on GitHub and npm.
//
// Usage: node scripts/check-readme.mjs [--readme README.md] [--tests tests]
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}
const readmePath = opt('--readme', 'README.md')
const testsDir = opt('--tests', 'tests')

/** Trailing whitespace off, outer blank lines off, common indentation off. */
function normalize(text) {
  const lines = text.split('\n').map(l => l.replace(/\s+$/, ''))
  while (lines.length && lines[0] === '') lines.shift()
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  const indents = lines.filter(Boolean).map(l => l.match(/^ */)[0].length)
  const indent = indents.length ? Math.min(...indents) : 0
  return lines.map(l => l.slice(indent)).join('\n')
}

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

function testRegions(dir, errors) {
  const regions = new Map()
  const files = readdirSync(dir, { recursive: true })
    .map(String)
    .filter(f => f.endsWith('.test.ts'))
    .map(f => join(dir, f))
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const found = new Set()
    const re = /^[ \t]*\/\/ readme:([a-z0-9-]+):start[^\n]*\n([\s\S]*?)^[ \t]*\/\/ readme:\1:end/gm
    for (const m of text.matchAll(re)) {
      if (regions.has(m[1])) errors.push(`test region "${m[1]}" is defined twice (${regions.get(m[1]).file}, ${file})`)
      regions.set(m[1], { file, code: normalize(m[2]) })
      found.add(m[1])
    }
    for (const m of text.matchAll(/\/\/ readme:([a-z0-9-]+):start/g)) {
      if (!found.has(m[1])) errors.push(`test region "${m[1]}" in ${file} has no matching end marker`)
    }
  }
  return regions
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
const regions = testRegions(testsDir, errors)

for (const [name, code] of blocks) {
  const region = regions.get(name)
  if (!region) { errors.push(`README block "${name}" has no test region (// readme:${name}:start)`); continue }
  const diff = firstDifference(code, region.code)
  if (diff) errors.push(`README block "${name}" differs from ${region.file} at line ${diff.line}:\n  README: ${diff.readme}\n  test:   ${diff.test}`)
}
for (const [name, region] of regions) {
  if (!blocks.has(name)) errors.push(`test region "${name}" (${region.file}) is not in the README (<!-- tested: ${name} -->)`)
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
console.log(`docs:check: ${blocks.size} tested blocks match, ${links} links resolve`)
