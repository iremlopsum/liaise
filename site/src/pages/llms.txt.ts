// /llms.txt (https://llmstxt.org): the docs' index for agents. Every page, in sidebar order, with its
// description, linking to its Markdown copy. Built from the content collection, so it can't drift.
import type { APIRoute } from 'astro'
import { loadPages, ROOT, SUMMARY } from '../llms/pages'
import { GROUPS } from '../nav'

export const GET: APIRoute = async () => {
  const { pages, compare } = await loadPages()
  const item = (p: { title: string; md: string; description?: string }) => `- [${p.title}](${p.md})${p.description ? `: ${p.description}` : ''}`
  const section = (label: string, dir: string) => [`## ${label}`, '', ...pages.filter((p) => p.groupDir === dir).map(item), '']
  const lines = [
    '# liaise',
    '',
    `> ${SUMMARY}`,
    '',
    'Install with `npm install liaise`. It is ESM only and has three entry points: `liaise` (createApi, defineRequest, createGraphQL and the rest), `liaise/middleware` (retryMiddleware, logMiddleware, cacheMiddleware) and `liaise/testing` (mockFetch and Result helpers).',
    '',
    `Every page below is linked as Markdown. The same page as HTML is at the same address without \`.md\`, with a trailing slash. All of the docs in one file: ${ROOT}/llms-full.txt`,
    '',
    ...GROUPS.filter((g) => g.dir !== 'about').flatMap((g) => section(g.label, g.dir)),
    '## Optional',
    '',
    ...pages.filter((p) => p.groupDir === 'about').map(item),
    item(compare),
    `- [Playground](${ROOT}/playground/): the real liaise build running in the browser, with editable examples.`,
    '- [Source on GitHub](https://github.com/iremlopsum/liaise): the code, the CHANGELOG and MIGRATION.md.',
    '',
  ]
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
