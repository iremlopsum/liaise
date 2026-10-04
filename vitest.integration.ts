import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const src = (file: string) => fileURLToPath(new URL(`./src/${file}`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^liaise$/, replacement: src('index.ts') },
      { find: /^liaise\/middleware$/, replacement: src('built-in-middleware.ts') },
      { find: /^liaise\/testing$/, replacement: src('testing.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
  },
})
