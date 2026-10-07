// Prefixes root-relative links in markdown with the site's base path (GitHub Pages serves the
// site under /liaise/). Leaves external links, #anchors and already-prefixed links alone.
export default function rehypeBaseLinks({ base }) {
  const visit = node => {
    if (node.type === 'element' && node.tagName === 'a' && typeof node.properties?.href === 'string') {
      const h = node.properties.href
      if (h.startsWith('/') && !h.startsWith(base + '/') && !h.startsWith('//')) node.properties.href = base + h
    }
    for (const c of node.children ?? []) visit(c)
  }
  return tree => visit(tree)
}
