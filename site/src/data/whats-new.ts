// ?raw: bundled at build time, since the prerender bundle's import.meta.url is not this file's.
import text from '../../../CHANGELOG.md?raw'
import { headings, sectionBody } from '../../../scripts/changelog.mjs'

export function whatsNew() {
  const { version } = headings(text)[0]
  const first = (sectionBody(text, version) ?? '').replace(/\s+/g, ' ').match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? ''
  return { version, text: first.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`/g, ''), href: `https://github.com/iremlopsum/liaise/releases/tag/v${version}` }
}
