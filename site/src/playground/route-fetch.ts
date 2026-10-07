// Where a `fetch` made while an example runs goes. Only the fake host is fake:
//   'page'  the site's own files (the editor's types, the search index): the real fetch, not logged
//   'fake'  FAKE_ORIGIN: the fake API in fake-server.ts
//   'real'  any other origin: the real fetch, logged in the network panel
import { FAKE_ORIGIN } from './fake-server'

export type FetchRoute = 'page' | 'fake' | 'real'

export function pickFetch(input: RequestInfo | URL, { pageOrigin }: { pageOrigin: string }): FetchRoute {
  const href = typeof input === 'string' ? input : 'href' in input ? input.href : input.url
  let origin: string
  try {
    origin = new URL(href, pageOrigin).origin // a relative URL resolves against the page
  } catch {
    return 'real' // not a URL: the real fetch rejects it as a browser would, and the panel shows it
  }
  return origin === pageOrigin ? 'page' : origin === FAKE_ORIGIN ? 'fake' : 'real'
}
