// /<group>/<page>.md: each docs page as plain Markdown, for agents (src/llms/markdown.ts).
import type { APIRoute } from 'astro'
import { loadPages } from '../llms/pages'

export async function getStaticPaths() {
  const { pages } = await loadPages()
  return pages.map((p) => ({ params: { slug: p.id }, props: { markdown: p.markdown } }))
}

export const GET: APIRoute = ({ props }) =>
  new Response(props.markdown as string, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
