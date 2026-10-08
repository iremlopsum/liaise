// @ts-check
import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'
import mdx from '@astrojs/mdx'
import react from '@astrojs/react'
import sitemap from '@astrojs/sitemap'
import { fileURLToPath } from 'node:url'

import rehypeBaseLinks from './plugins/rehype-base-links.mjs'
import rehypeScrollTables from './plugins/rehype-scroll-tables.mjs'
import monacoCssWithEditor from './plugins/vite-monaco-css.mjs'

// GitHub Pages project site: served under /liaise/ (no custom domain, owner 2026-10-07).
export default defineConfig({
  site: 'https://iremlopsum.github.io',
  base: '/liaise',
  output: 'static',
  integrations: [mdx(), react(), sitemap({ filter: (page) => !page.endsWith('/404/') })],
  trailingSlash: 'always',
  vite: {
    // monacoCssWithEditor: the editor's CSS loads with the editor, not in every playground page's <head>.
    plugins: [tailwindcss(), monacoCssWithEditor()],
    // The repo's tests/, where <Example> reads its regions. Resolved here because a component's
    // own import.meta.url points into dist/ once bundled, where ../../../tests is site/tests.
    define: { __LIAISE_TESTS_DIR__: JSON.stringify(fileURLToPath(new URL('../tests/', import.meta.url))) },
  },
  markdown: { shikiConfig: { theme: 'github-dark-default' }, rehypePlugins: [[rehypeBaseLinks, { base: '/liaise' }], rehypeScrollTables] },
})
