import { describe, it, expect } from 'vitest'
import { mdxToMarkdown, pageMarkdown } from '../src/llms/markdown'

const root = 'https://iremlopsum.github.io/liaise'
const opts = {
  root,
  regions: new Map([['demo', { code: "const a = 1\n\nconst b = 2" }]]),
  markdownPaths: new Set(['/guide/handling-errors/', '/compare/']),
}

describe('mdxToMarkdown', () => {
  it('replaces <Example> with a ts fence holding the region, at the same indentation', () => {
    expect(mdxToMarkdown('Top\n\n<Example name="demo" />\n', opts)).toBe('Top\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n')
    expect(mdxToMarkdown('- item\n\n  <Example name="demo" />\n', opts)).toBe('- item\n\n  ```ts\n  const a = 1\n\n  const b = 2\n  ```\n')
  })

  it('refuses an <Example> with no region, like the page does', () => {
    expect(() => mdxToMarkdown('<Example name="missing" />', opts)).toThrow('no test region')
  })

  it('drops untyped markers', () => {
    expect(mdxToMarkdown('A\n{/* untyped: two alternatives */}\n```ts\nx\n```\n', opts)).toBe('A\n```ts\nx\n```\n')
  })

  it('makes root links absolute, to the .md copy when there is one, keeping the anchor', () => {
    const md = mdxToMarkdown('See [errors](/guide/handling-errors/#kinds), [the intro](/intro/), [results](/compare/) and [npm](https://npmjs.com/x).', opts)
    expect(md).toBe(`See [errors](${root}/guide/handling-errors.md#kinds), [the intro](${root}/intro/), [results](${root}/compare.md) and [npm](https://npmjs.com/x).\n`)
  })

  it('leaves code fences alone', () => {
    const body = '```tsx\n<Example name="demo" />\n[x](/intro/)\n{/* untyped: no */}\n```'
    expect(mdxToMarkdown(body, opts)).toBe(body + '\n')
  })

  it('refuses any other MDX component, so a new one cannot leak into the Markdown as a tag', () => {
    expect(() => mdxToMarkdown('<Playground example="x" />', opts)).toThrow('unconverted MDX component')
    expect(mdxToMarkdown('Call `defineRequest<User>()` first.', opts)).toBe('Call `defineRequest<User>()` first.\n')
  })

  it('pageMarkdown leads with the title, the description and the HTML address', () => {
    const md = pageMarkdown({ title: 'Handling errors', description: 'Six kinds.', url: `${root}/guide/handling-errors/`, body: 'Body.' }, opts)
    expect(md).toBe(`# Handling errors\n\n> Six kinds.\n\nSource: ${root}/guide/handling-errors/\n\nBody.\n`)
  })
})
