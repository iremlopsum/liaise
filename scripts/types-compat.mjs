// The Quick start says liaise's types compile on TypeScript versions back to 4.7.
// Until 5.3.0 that was a hand check (BACKLOG §7). This makes it a tested claim:
// pack the built package (what npm ships: the exports map and the .d.ts files),
// install it with each TypeScript version below into a temp project, and compile
// scripts/types-compat/use.ts with skipLibCheck off. `node16` resolution on every
// version, `bundler` from 5.0 on (it didn't exist before). The old `node`
// resolution is not checked: it can't see the subpath entries, which the Quick
// start says.
//
// The list is pinned, not "latest": a new TypeScript release must not turn an
// unrelated pull request red. Adding a version is a deliberate one-line change,
// like a size budget. Run after `npm run build` (it packs dist/).
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const VERSIONS = [
  '4.7.4', '4.8.4', '4.9.5',
  '5.0.4', '5.1.6', '5.2.2', '5.3.3', '5.4.5', '5.5.4', '5.6.3', '5.7.3', '5.8.3', '5.9.3',
  '6.0.3',
]

const alias = version => `ts${version.split('.').slice(0, 2).join('')}`
const major = version => Number(version.split('.')[0])

const dir = mkdtempSync(join(tmpdir(), 'liaise-types-'))
let failed = false
try {
  const tarball = execFileSync('npm', ['pack', '--silent', '--pack-destination', dir], { encoding: 'utf8' }).trim().split('\n').pop()
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'liaise-types-compat', private: true, type: 'module' }))
  for (const file of ['use.ts', 'tsconfig.node16.json', 'tsconfig.bundler.json']) {
    cpSync(join('scripts/types-compat', file), join(dir, file))
  }
  // --ignore-scripts: nothing installed here needs to run code to be type-checked.
  execFileSync('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--silent',
    join(dir, tarball),
    ...VERSIONS.map(v => `${alias(v)}@npm:typescript@${v}`),
  ], { cwd: dir, stdio: 'inherit' })

  for (const version of VERSIONS) {
    for (const resolution of major(version) >= 5 ? ['node16', 'bundler'] : ['node16']) {
      const tsc = join(dir, 'node_modules', alias(version), 'bin', 'tsc')
      const run = spawnSync(process.execPath, [tsc, '-p', `tsconfig.${resolution}.json`], { cwd: dir, encoding: 'utf8' })
      const errors = (run.stdout.match(/error TS\d+/g) ?? []).length
      const ok = run.status === 0
      console.log(`TypeScript ${version.padEnd(6)} ${resolution.padEnd(8)} ${ok ? 'ok' : `FAILED (${errors} error${errors === 1 ? '' : 's'})`}`)
      if (!ok) {
        failed = true
        console.log((run.stdout + run.stderr).trim().split('\n').map(l => `    ${l}`).join('\n'))
      }
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
if (failed) process.exit(1)
