// Everything the agent-facing files are built from: each docs page as Markdown, in sidebar order,
// plus /compare/ (compare/results.md, written by the harness from the same results.json the page
// reads). Used by pages/[...slug].md.ts, compare.md.ts, llms.txt.ts and llms-full.txt.ts.
import { getCollection } from 'astro:content'
import { getNav, GROUPS } from '../nav'
import { findRegions } from '../../../scripts/examples.mjs'
import { pageMarkdown, type MarkdownOptions } from './markdown'
import { CONTENDERS, data, list } from '../compare'
import compareResults from '../../../compare/results.md?raw'

declare const __LIAISE_TESTS_DIR__: string // the repo's tests/, set in astro.config.mjs

/** https://iremlopsum.github.io/liaise, no trailing slash. */
export const ROOT = new URL(import.meta.env.BASE_URL, import.meta.env.SITE).href.replace(/\/$/, '')

export const SUMMARY =
  'liaise is a type-safe REST and GraphQL client for TypeScript, built on the standard fetch, with zero runtime dependencies. Every call returns a Result, { data, error }, instead of throwing, and error.kind names the failure: http, network, timeout, abort, parse or middleware.'

export type MdPage = { id: string; title: string; description?: string; group: string; groupDir: string; html: string; md: string; markdown: string }

let cache: Promise<{ pages: MdPage[]; compare: MdPage }> | undefined

export function loadPages() {
  cache ??= build()
  return cache
}

async function build() {
  const docs = await getCollection('docs')
  const { flat } = await getNav()
  const { regions } = findRegions(__LIAISE_TESTS_DIR__)
  const markdownPaths = new Set([...docs.map((d) => `/${d.id}/`), '/compare/'])
  const opts: MarkdownOptions = { root: ROOT, regions, markdownPaths }
  const byId = new Map(docs.map((d) => [d.id, d]))

  const pages = flat.map((item): MdPage => {
    const entry = byId.get(item.id)!
    const html = `${ROOT}/${item.id}/`
    const page = { title: entry.data.title, description: entry.data.description, url: html, body: entry.body ?? '' }
    return {
      id: item.id,
      title: page.title,
      description: page.description,
      group: item.group,
      groupDir: GROUPS.find((g) => item.id.startsWith(g.dir + '/'))!.dir,
      html,
      md: `${ROOT}/${item.id}.md`,
      markdown: pageMarkdown(page, opts),
    }
  })

  const compareBody = compareResults.replace(/^# [^\n]*\n/, '')
  const compare: MdPage = {
    id: 'compare',
    title: 'How liaise compares',
    // The same description as pages/compare.astro's.
    description: `${list(CONTENDERS)} through ${data.scenarios.length} failure scenarios, with bundle size and request overhead against plain fetch as the baseline. Every number comes from the comparison harness's last run.`,
    group: 'Compare',
    groupDir: 'compare',
    html: `${ROOT}/compare/`,
    md: `${ROOT}/compare.md`,
    markdown: '',
  }
  compare.markdown = pageMarkdown({ title: compare.title, description: compare.description, url: compare.html, body: compareBody }, opts)
  return { pages, compare }
}
