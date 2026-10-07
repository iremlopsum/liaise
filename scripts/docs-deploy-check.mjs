// Docs-only deploys must not publish behaviour npm doesn't have: refuse when anything that
// ships changed since the latest release tag (spec §4). "Ships" means src/, the compiler
// config, and the package.json fields that decide what npm installs and how it resolves.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Paths whose change alters the compiled output.
export const SHIPPED_PATHS = ['src', 'tsconfig.json']

// package.json keys that reach consumers. In: identity and module format (name, version,
// type, sideEffects), entry points and contents (main, module, types, exports, files, bin,
// browser), what gets installed alongside (the four dependency kinds) and where it runs
// (engines). Out, deliberately: scripts and devDependencies (build tooling, never installed
// by consumers) and metadata (description, keywords, repository, ...), which do not change
// what the package does.
export const SHIPPED_FIELDS = [
  'name', 'version', 'type', 'sideEffects',
  'main', 'module', 'types', 'exports', 'files',
  'dependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies',
  'engines', 'bin', 'browser',
]

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function changedShipped(root, tag) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const changed = git('diff', '--name-only', `${tag}..HEAD`, '--', ...SHIPPED_PATHS).split('\n').filter(Boolean)
  const before = JSON.parse(git('show', `${tag}:package.json`))
  const now = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  for (const f of SHIPPED_FIELDS) if (!same(before[f], now[f])) changed.push(`package.json ${f}`)
  return changed
}

function main() {
  const at = process.argv.indexOf('--root')
  const root = at === -1 ? '.' : process.argv[at + 1]
  const tags = execFileSync('git', ['tag', '--list', 'v*', '--sort=-v:refname'], { cwd: root, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean)
  if (!tags.length) { console.error('docs-deploy: no v* tag — nothing has been released'); process.exit(1) }
  const changed = changedShipped(root, tags[0])
  if (changed.length) {
    console.error(`docs-deploy: library code changed since ${tags[0]} (${changed.join(', ')}): release first`)
    process.exit(1)
  }
  console.log(`docs-deploy: ok (no library change since ${tags[0]})`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
