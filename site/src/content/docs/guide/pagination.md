---
title: "Pagination"
order: 10
---
Many list endpoints return one page at a time. `paginate` walks through the pages and gives you one `Result` per page:

```ts
import { createApi, defineRequest, paginate } from 'liaise'

type Item = { id: string; name: string }
type Page = { items: Item[]; cursor?: string }

const listItems = defineRequest<Page, { limit: number; cursor?: string }>()({
  method: 'GET',
  path: '/items',
})

const api = createApi({ baseUrl: 'https://api.example.com', requests: { listItems } })

for await (const page of paginate(api.listItems, { limit: 50 }, {
  next: (p, prev) => (p.data.cursor ? { ...prev, cursor: p.data.cursor } : undefined),
})) {
  if (page.error) break
  render(page.data.items)
}
```

`render` stands for your own code.

- **`next` returns the params for the next page.** It gets the page just loaded and the params that loaded it, so the usual case is a spread. liaise never has to guess whether your API calls it `cursor`, `page_token` or `after`, and the same shape covers every scheme:

  <!-- untyped: two alternative `next` option values shown side by side, not one program -->
  ```ts
  // offset
  next: (p, prev) => p.data.items.length === prev.limit
    ? { ...prev, offset: prev.offset + prev.limit }
    : undefined

  // page number, driven by a Link header
  next: (p, prev) => p.response.headers.get('link')?.includes('rel="next"')
    ? { ...prev, page: prev.page + 1 }
    : undefined
  ```

- **Return `undefined` or `null` to stop.**
- **An error page ends the walk.** You get the error page, and then the loop ends, because there is no data to read the next cursor from. You see what failed. The loop never stops quietly.
- **`maxPages` has no default.** Set it if you want a ceiling, as in `paginate(api.listItems, { limit: 50 }, { next, maxPages: 100 })`. liaise doesn't pick a number, because a silent cut-off at an arbitrary page looks exactly like reaching the last one.
- **Every other option applies to every page.** Any of the [`CallOptions`](/reference/calloptions/), such as `signal`, `timeout` or `headers`, goes with each request, so one signal cancels the whole walk.
- **`paginate` yields pages.** Read the items from each page yourself. Flattening them would mean guessing which field holds the array.
