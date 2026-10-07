import { createApi, defineRequest } from 'liaise'

const search = defineRequest<string[], { q: string }>()({
  method: 'GET',
  path: '/search',
  dedupe: true, // a new call cancels the one still in flight
})
const api = createApi({ baseUrl: 'https://api.example.com', requests: { search } })

// Someone types "liaise", one key every 60 ms.
// The server answers short queries more slowly.
const keystrokes = ['l', 'li', 'lia', 'liai', 'liais', 'liaise']

await Promise.all(
  keystrokes.map(async (q, i) => {
    await new Promise((wait) => setTimeout(wait, i * 60))
    const { data, error } = await api.search({ q })

    if (error?.kind === 'abort') console.log(`"${q}" cancelled`)
    else if (data) console.log(`"${q}" shows`, data)
  }),
)
