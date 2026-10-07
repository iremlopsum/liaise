// The deploy workflows' security and ordering rules, read off the YAML. The site's build installs
// and runs third-party packages, so it must never share a job with a token that can deploy:
// release.yml runs in the workflow npm trusts for publishing, and Pages trusts the OIDC token.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const FILES = ['release.yml', 'docs.yml', 'ci.yml']
const SITE = /--prefix site\b/
const text = (file: string) => readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8')

// The workflows are plain block YAML: a job is a two-space key under `jobs:`, its settings four
// spaces in, its steps `      - ` items. Comment lines are dropped.
function jobs(file: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let current: string[] | undefined
  let inJobs = false
  for (const line of text(file).split('\n').filter(l => !/^\s*#/.test(l))) {
    if (/^\S/.test(line)) { inJobs = line.startsWith('jobs:'); current = undefined; continue }
    if (!inJobs) continue
    const id = /^ {2}([\w-]+):\s*$/.exec(line)?.[1]
    if (id) out.set(id, (current = []))
    else current?.push(line)
  }
  return out
}
const job = (file: string, id: string) => {
  const j = jobs(file).get(id)
  expect(j, `${file} has a job ${id}`).toBeDefined()
  return j!
}

/** `key: value` pairs of the block under `head` (at `indent`), or null when there is no such block. */
function block(lines: string[], head: string, indent: number): Record<string, string> | null {
  const pad = ' '.repeat(indent)
  const at = lines.findIndex(l => l.startsWith(`${pad}${head}:`))
  if (at === -1) return null
  if (/:\s*\{\}\s*$/.test(lines[at])) return {}
  const out: Record<string, string> = {}
  for (const l of lines.slice(at + 1)) {
    const m = new RegExp(`^${pad}  ([\\w-]+):\\s*(.*?)\\s*$`).exec(l)
    if (!m) break
    out[m[1]] = m[2]
  }
  return out
}
/** A job's permissions: its own, or the workflow's when it sets none. */
const permissions = (file: string, id: string) =>
  block(job(file, id), 'permissions', 4) ?? block(text(file).split('\n'), 'permissions', 0) ?? {}
/** A job-level setting on one line (`if:`, `needs:`), or ''. */
const setting = (lines: string[], key: string) =>
  lines.map(l => new RegExp(`^ {4}${key}:\\s*(.+)$`).exec(l)?.[1]).find(Boolean) ?? ''
/** Each step as its trimmed lines, joined: `uses: …`, `run: …`, `persist-credentials: false`. */
function steps(lines: string[]): string[] {
  const out: string[] = []
  const at = lines.findIndex(l => /^ {4}steps:\s*$/.test(l))
  if (at === -1) return out
  for (const l of lines.slice(at + 1)) {
    if (/^ {4}\S/.test(l)) break
    if (/^ {6}- /.test(l)) out.push(l.slice(8))
    else if (out.length && l.trim()) out[out.length - 1] += `\n${l.trim()}`
  }
  return out
}
const uses = (step: string) => /^uses: (\S+)/m.exec(step)?.[1] ?? ''

describe('docs deploys: what runs third-party code never holds a deploy token', () => {
  it('a job that installs or runs the site can only read the repo, and keeps no git credentials', () => {
    const seen: string[] = []
    for (const f of FILES) for (const [id, lines] of jobs(f)) {
      if (!lines.some(l => SITE.test(l))) continue
      seen.push(`${f} ${id}`)
      expect(permissions(f, id), `${f} ${id}`).toEqual({ contents: 'read' })
      const checkouts = steps(lines).filter(s => uses(s).startsWith('actions/checkout@'))
      expect(checkouts.length, `${f} ${id}`).toBeGreaterThan(0)
      for (const s of checkouts) expect(s, `${f} ${id}`).toMatch(/^persist-credentials: false$/m)
    }
    expect(seen.sort()).toEqual(['ci.yml site', 'docs.yml build', 'release.yml docs-build'])
  })

  it('a job that deploys Pages runs actions/deploy-pages and nothing else, after a build job, one deploy at a time', () => {
    const seen: string[] = []
    for (const f of FILES) for (const [id, lines] of jobs(f)) {
      if (!('pages' in permissions(f, id))) continue
      seen.push(`${f} ${id}`)
      expect(permissions(f, id), `${f} ${id}`).toEqual({ pages: 'write', 'id-token': 'write' })
      const s = steps(lines)
      expect(s.map(uses), `${f} ${id}`).toEqual([expect.stringMatching(/^actions\/deploy-pages@[0-9a-f]{40}$/)])
      expect(s[0], `${f} ${id}`).not.toMatch(/^run:/m)
      expect(block(lines, 'environment', 4)?.name, `${f} ${id}`).toBe('github-pages')
      expect(block(lines, 'concurrency', 4), `${f} ${id}`).toEqual({ group: 'pages', 'cancel-in-progress': 'false' })
      // The workflow itself must not hold the same group: a run would then wait on itself.
      expect(block(text(f).split('\n'), 'concurrency', 0)?.group, `${f} workflow-level concurrency`).not.toBe('pages')
      // What it deploys comes from a job that builds the site and uploads it.
      const build = setting(lines, 'needs')
      const built = steps(job(f, build))
      expect(built.some(st => uses(st).startsWith('actions/upload-pages-artifact@') && /^path: site\/dist$/m.test(st)), `${f} ${build}`).toBe(true)
      expect(built.some(st => /^run: .*npm --prefix site test\b/m.test(st)), `${f} ${build} runs the site's tests`).toBe(true)
    }
    expect(seen.sort()).toEqual(['docs.yml deploy', 'release.yml docs-deploy'])
  })

  it('docs.yml refuses before it builds: the guard is the first command, with the tags fetched', () => {
    const s = steps(job('docs.yml', 'build'))
    expect(s.find(st => /^run:/m.test(st))).toBe('run: node scripts/docs-deploy-check.mjs')
    expect(s.find(st => uses(st).startsWith('actions/checkout@'))).toMatch(/^fetch-depth: 0$/m)
  })
})

describe('release.yml', () => {
  it('deploys docs only for the newest version, only after its Release, never on a dry run', () => {
    expect(job('release.yml', 'check')).toContain('      latest: ${{ steps.decide.outputs.latest }}')
    const cond = setting(job('release.yml', 'docs-build'), 'if')
    expect(cond).toContain("needs.check.outputs.latest == 'true'")
    expect(cond).toContain("needs.check.outputs.dry_run != 'true'")
    expect(cond).toContain("needs.release.result == 'success'")
    // On the repair path `publish` is skipped; the default success() would skip the deploy too.
    const deploy = job('release.yml', 'docs-deploy')
    expect(setting(deploy, 'needs')).toBe('docs-build')
    expect(setting(deploy, 'if')).toBe("${{ !cancelled() && needs.docs-build.result == 'success' }}")
  })

  it('the gate runs every check prepublishOnly runs, so none can first fail after the owner approves', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const checks = String(pkg.scripts.prepublishOnly).split('&&').map(s => s.trim())
    expect(checks.length).toBeGreaterThan(5)
    const gate = steps(job('release.yml', 'gate'))
    for (const c of checks) expect(gate, c).toContain(`run: ${c}`)
  })
})
