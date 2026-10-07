import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const src = (f: string) => fileURLToPath(new URL(`../src/${f}`, import.meta.url))
export default defineConfig({
  resolve: {
    alias: [
      { find: /^liaise$/, replacement: src('index.ts') },
      { find: /^liaise\/middleware$/, replacement: src('built-in-middleware.ts') },
      { find: /^liaise\/testing$/, replacement: src('testing.ts') },
    ],
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 30_000 },
})
