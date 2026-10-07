// ?raw and a JSON import: bundled at build time, since the prerender bundle's import.meta.url is not this file's.
import text from '../../../CHANGELOG.md?raw'
import pkg from '../../../package.json'
import { sectionBody } from '../../../scripts/changelog.mjs'

/**
 * The front page's pill for `version`: the first sentence of its CHANGELOG section, linking to its
 * GitHub Release. null when the CHANGELOG has no section for it. Never the newest section: a release
 * PR's entry can be merged before npm has that version, and docs.yml can deploy in between.
 */
export function whatsNewFor(changelog: string, version: string) {
  const body = sectionBody(changelog, version)
  if (body === null) return null
  const first = body.replace(/\s+/g, ' ').match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? ''
  return { version, text: first.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`/g, ''), href: `https://github.com/iremlopsum/liaise/releases/tag/v${version}` }
}

/** The pill for the released version: package.json's, which a docs deploy never runs ahead of. */
export const whatsNew = () => whatsNewFor(text, pkg.version)
