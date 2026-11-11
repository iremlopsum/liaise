// A docs page as plain Markdown, for agents: /<id>.md, llms-full.txt. The pages are MDX, but the
// only component they use is <Example name="…" />, so the conversion is three line-level rewrites,
// none of them inside a code fence:
//   <Example name="x" />   → a ```ts fence holding test region x (the same code the page shows)
//   {/* untyped: … */}     → dropped (a note for docs:types, not for readers)
//   [text](/root/link/)    → an absolute URL; a doc page's link goes to its .md copy
// Pure, with no astro imports, so tests/llms-markdown.test.ts runs it without a build.

export type Regions = Map<string, { code: string }>

export interface MarkdownOptions {
  /** Absolute site root with the base and no trailing slash: https://iremlopsum.github.io/liaise */
  root: string
  /** Test regions by name (scripts/examples.mjs findRegions). */
  regions: Regions
  /** Root-relative paths ('/guide/handling-errors/') that have a Markdown copy at <path minus slash>.md. */
  markdownPaths: Set<string>
}

const FENCE = /^\s*(```|~~~)/
const EXAMPLE = /^(\s*)<Example name="([a-z0-9-]+)" \/>\s*$/
const UNTYPED = /^\s*\{\/\*[\s\S]*?\*\/\}\s*$/
const LINK = /\]\((\/[^)\s#]*)(#[^)\s]*)?\)/g

/** Where a root-relative link points in the Markdown: the .md copy when there is one, else the page. */
export function absoluteLink(path: string, hash: string, { root, markdownPaths }: Pick<MarkdownOptions, 'root' | 'markdownPaths'>) {
  if (markdownPaths.has(path)) return `${root}${path.replace(/\/$/, '')}.md${hash}`
  return `${root}${path}${hash}`
}

export function mdxToMarkdown(body: string, opts: MarkdownOptions): string {
  const out: string[] = []
  let fence: string | null = null
  for (const line of body.split('\n')) {
    const f = line.match(FENCE)
    if (fence) {
      out.push(line)
      if (f && f[1] === fence) fence = null
      continue
    }
    if (f) { fence = f[1]; out.push(line); continue }
    const ex = line.match(EXAMPLE)
    if (ex) {
      const [, indent, name] = ex
      const region = opts.regions.get(name)
      if (!region) throw new Error(`<Example name="${name}">: no test region // example:${name}:start`)
      out.push(...['```ts', ...region.code.split('\n'), '```'].map((l) => (l ? indent + l : l)))
      continue
    }
    if (UNTYPED.test(line)) continue
    if (/<[A-Z][A-Za-z]*[\s/>]/.test(line.replace(/`[^`]*`/g, ''))) throw new Error(`unconverted MDX component: ${line.trim()}`)
    out.push(line.replace(LINK, (_, path: string, hash = '') => `](${absoluteLink(path, hash, opts)})`))
  }
  if (fence) throw new Error('unclosed code fence')
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/** One page: title, its description as the lead, where the HTML lives, then the body. */
export function pageMarkdown(page: { title: string; description?: string; url: string; body: string }, opts: MarkdownOptions) {
  const head = [`# ${page.title}`, '']
  if (page.description) head.push(`> ${page.description}`, '')
  head.push(`Source: ${page.url}`, '')
  return head.join('\n') + '\n' + mdxToMarkdown(page.body, opts)
}
