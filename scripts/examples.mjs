// Test regions that docs show: `// example:<name>:start` … `// example:<name>:end` inside
// tests/**/*.test.ts. The README copies them (checked by check-docs.mjs); the site includes them
// at build time (site/src/components/Example.astro). One source, so an example cannot drift
// from code CI runs.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Trailing whitespace off, outer blank lines off, common indentation off. */
export function normalize(text) {
  const lines = text.split('\n').map(l => l.replace(/\s+$/, ''))
  while (lines.length && lines[0] === '') lines.shift()
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  const indents = lines.filter(Boolean).map(l => l.match(/^ */)[0].length)
  const indent = indents.length ? Math.min(...indents) : 0
  return lines.map(l => l.slice(indent)).join('\n')
}

export function findRegions(dir) {
  const regions = new Map(), errors = []
  const files = readdirSync(dir, { recursive: true }).map(String).filter(f => f.endsWith('.test.ts')).map(f => join(dir, f))
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const found = new Set()
    const re = /^[ \t]*\/\/ example:([a-z0-9-]+):start[^\n]*\n([\s\S]*?)^[ \t]*\/\/ example:\1:end/gm
    for (const m of text.matchAll(re)) {
      if (regions.has(m[1])) errors.push(`test region "${m[1]}" is defined twice (${regions.get(m[1]).file}, ${file})`)
      regions.set(m[1], { file, code: normalize(m[2]) })
      found.add(m[1])
    }
    for (const m of text.matchAll(/\/\/ example:([a-z0-9-]+):start/g)) {
      if (!found.has(m[1])) errors.push(`test region "${m[1]}" in ${file} has no matching end marker`)
    }
  }
  return { regions, errors }
}
