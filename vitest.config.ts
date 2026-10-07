import { fileURLToPath } from 'node:url'
import { defineConfig, configDefaults } from 'vitest/config'

const src = (file: string) => fileURLToPath(new URL(`./src/${file}`, import.meta.url))

export default defineConfig({
  // README examples import 'liaise' by its published name. These aliases point
  // that name at src/, so a tested README block is byte-identical to the test
  // that runs it (scripts/check-docs.mjs) and needs no build first.
  resolve: {
    alias: [
      { find: /^liaise$/, replacement: src('index.ts') },
      { find: /^liaise\/middleware$/, replacement: src('built-in-middleware.ts') },
      { find: /^liaise\/testing$/, replacement: src('testing.ts') },
    ],
  },
  test: {
    environment: 'node',
    // `.worktrees/` is excluded as a belt-and-braces guard. The actual rule is
    // "branches, not worktrees" (CLAUDE.md) — but a worktree is a full second
    // checkout, and if one ever appears the default globs discover BOTH copies
    // of every test file and each count doubles: an observed 708 tests across
    // 62 files where the suite has 354 across 31. Nothing fails, which is the
    // problem — a doubled green number reads like a win.
    //
    // Spread `configDefaults.exclude` rather than replacing it — setting
    // `exclude` overrides vitest's defaults outright, which would start
    // pulling in `node_modules` and the compiled `dist/`.
    //
    // `compare/` is the library comparison harness: its own package.json, its
    // own dependencies, never part of this suite.
    // `site/` is the docs site: its own package.json and its own vitest run, which
    // reads a built `site/dist` this suite never has.
    exclude: [...configDefaults.exclude, '**/.worktrees/**', 'compare/**', 'site/**'],
    typecheck: { tsconfig: './tsconfig.test.json', include: ['tests/**/*.test.ts', 'tests/**/*.test-d.ts'], only: true },
  }
})
