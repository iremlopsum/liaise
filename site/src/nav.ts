import { getCollection } from 'astro:content'
import { url } from './url'

export const GROUPS = [
  { dir: 'start', label: 'Getting started' },
  { dir: 'guide', label: 'Guide' },
  { dir: 'recipes', label: 'Recipes' },
  { dir: 'choosing', label: 'Choosing liaise' },
  { dir: 'reference', label: 'Reference' },
  { dir: 'about', label: 'About' },
]

export type NavItem = { id: string; title: string; href: string; group: string }

export async function getNav() {
  const docs = await getCollection('docs')
  const groups = GROUPS.map((g) => ({
    ...g,
    items: docs
      .filter((d) => d.id.startsWith(g.dir + '/'))
      .sort((a, b) => a.data.order - b.data.order)
      .map((d): NavItem => ({ id: d.id, title: d.data.title, href: url(`/${d.id}/`), group: g.label })),
  }))
  return { groups, flat: groups.flatMap((g) => g.items) }
}
