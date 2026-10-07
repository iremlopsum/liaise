// Test files run in parallel. A file that writes files keeps them in its own directory, named after
// it, under tests/.tmp/: then one file's cleanup never deletes what another is about to import.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'

describe('test isolation', () => {
  it('every test file writes only under tests/.tmp/<its name>/', () => {
    const dir = new URL('./', import.meta.url)
    const used: string[] = []
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.test.ts'))) {
      const src = readFileSync(new URL(f, dir), 'utf8')
      for (const m of src.matchAll(/['"`]\.\/\.tmp\/([^'"`]*)['"`]/g)) {
        used.push(`${f}: .tmp/${m[1]}`)
        expect(`.tmp/${m[1]}`, f).toMatch(new RegExp(`^\\.tmp/${f.replace(/\.test\.ts$/, '')}/`))
      }
    }
    expect(used.length).toBeGreaterThanOrEqual(2)
  })
})
