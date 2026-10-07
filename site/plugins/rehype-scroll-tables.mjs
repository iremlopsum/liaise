// Wraps every table in a box that scrolls on its own, so a wide table never widens the page on a
// phone. A wrapper rather than `display: block` on the table, which drops its table semantics for
// some screen readers. The box is a named, focusable region so a keyboard user can scroll it.
export default function rehypeScrollTables() {
  const visit = node => {
    const kids = node.children
    if (!kids) return
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i]
      if (c.type === 'element' && c.tagName === 'table') {
        kids[i] = {
          type: 'element',
          tagName: 'div',
          properties: { className: ['table-scroll'], role: 'region', ariaLabel: 'Table', tabIndex: 0 },
          children: [c],
        }
      } else visit(c)
    }
  }
  return tree => visit(tree)
}
