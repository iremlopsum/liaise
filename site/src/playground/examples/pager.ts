import { createApi, defineRequest, createPager } from 'liaise'

type Item = { id: number; name: string }
type Page = { items: Item[]; total: number }

const listItems = defineRequest<Page, { offset: number; limit: number }>()({ method: 'GET', path: '/items' })
const api = createApi({ baseUrl: 'https://api.example.com', requests: { listItems } })

const pager = createPager(api.listItems, { offset: 0, limit: 25 }, {
  toParams: (page, params) => ({ ...params, offset: (page - 1) * params.limit }),
  pageCount: r => Math.ceil(r.data.total / 25),
  cache: true,
})

// Your UI would render here. This logs every change instead.
pager.subscribe(() => {
  const { loading, target, page, pageCount, data } = pager.state
  if (loading) console.log(`loading page ${target}`)
  else console.log(`page ${page} of ${pageCount}, from ${data?.items[0]?.name}`)
})

await pager.load()

// Two quick clicks: page 3 answers slowly, and the reader picks 5 while it loads.
const to3 = pager.goTo(3)
await new Promise(r => setTimeout(r, 100))
await pager.goTo(5)
console.log(`the move to page 3 resolved with ${(await to3)?.error?.kind}`)

await pager.goTo(1) // back to the first page
