// @ts-check
import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'
import mdx from '@astrojs/mdx'

import rehypeBaseLinks from './plugins/rehype-base-links.mjs'

// GitHub Pages project site: served under /liaise/ (no custom domain, owner 2026-10-07).
export default defineConfig({
  site: 'https://iremlopsum.github.io',
  base: '/liaise',
  output: 'static',
  integrations: [mdx()],
  trailingSlash: 'always',
  vite: { plugins: [tailwindcss()] },
  markdown: { shikiConfig: { theme: 'github-dark-default' }, rehypePlugins: [[rehypeBaseLinks, { base: '/liaise' }]] },
})
