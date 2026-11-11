// /compare.md: the comparison results as Markdown (compare/results.md, from the same run as /compare/).
import type { APIRoute } from 'astro'
import { loadPages } from '../llms/pages'

export const GET: APIRoute = async () =>
  new Response((await loadPages()).compare.markdown, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
