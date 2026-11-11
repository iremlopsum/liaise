// /llms-full.txt: every docs page as Markdown in one file, in sidebar order, then the comparison results.
import type { APIRoute } from 'astro'
import { loadPages, ROOT, SUMMARY } from '../llms/pages'

export const GET: APIRoute = async () => {
  const { pages, compare } = await loadPages()
  const head = `# liaise documentation\n\n> ${SUMMARY}\n\nEvery page of ${ROOT}/ in one file. The index is ${ROOT}/llms.txt.\n`
  const body = [...pages, compare].map((p) => p.markdown.trim())
  return new Response([head, ...body].join('\n\n---\n\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
