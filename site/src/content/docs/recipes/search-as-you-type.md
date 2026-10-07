---
title: "Search as you type"
order: 2
---
Each keystroke starts a request, and a slow answer to an early one can arrive after a fast answer to a later one. `dedupe` makes sure only the latest search is shown.

`Repo` is your result type; `render` and `showError` stand for your UI code.

<!-- tested: search-as-you-type -->
```ts
import { createApi, defineRequest } from 'liaise'

const search = defineRequest<Repo[], { q: string }>()({
  method: 'GET',
  path: '/search',
  dedupe: true, // a new call cancels the one still in flight
})
const api = createApi({ baseUrl: '/api', requests: { search } })

async function onInput(q: string) {
  const { data, error } = await api.search({ q })
  if (error?.kind === 'abort') return // a newer search replaced this one
  if (error) return showError(error)
  render(data)
}
```

The older call settles with an `abort` error, which you skip. Only the newest search reaches `render`.
