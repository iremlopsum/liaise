import { ofetch } from 'ofetch'
import { readFileSync } from 'node:fs'

// Doc source: the README shipped in node_modules/ofetch (1.5.1), the same text as
// https://github.com/unjs/ofetch/blob/v1.5.1/README.md
const pkg = JSON.parse(readFileSync(new URL('../node_modules/ofetch/package.json', import.meta.url), 'utf8'))
const README = 'https://github.com/unjs/ofetch/blob/v1.5.1/README.md'
// GitHub keeps the U+FE0F of the README's "✔️" headings in the anchor, hence %EF%B8%8F.
const DOCS = {
  parsing: `${README}#%EF%B8%8F-parsing-response`,
  retry: `${README}#%EF%B8%8F-auto-retry`,
  timeout: `${README}#%EF%B8%8F-timeout`,
  interceptors: `${README}#%EF%B8%8F-interceptors`,
  onResponseError: `${README}#onresponseerror-request-options-response-`,
  abort: 'https://developer.mozilla.org/en-US/docs/Web/API/AbortController',
  abortTimeout: 'https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static',
}

/** The naive refresh every library's default variant uses: on 401, POST the refresh token, retry once. */
async function naiveAuth(http, { auth }, path) {
  const is401 = e => e?.response?.status === 401
  const get = token => http(path, { headers: { authorization: `Bearer ${token}` } })
  const post = body => http('/s/refresh', { method: 'POST', body })
  const first = await get(auth.access).catch(e => e)
  if (!is401(first)) {
    if (first instanceof Error) throw first
    return first
  }
  const t = await post({ token: auth.refresh })
  Object.assign(auth, t)
  return get(auth.access)
}

function createDefault(ctx) {
  // ofetch.create({ baseURL }) only so paths resolve against the test server.
  const http = ofetch.create({ baseURL: ctx.baseUrl })
  return {
    getJson: path => http(path),
    getUser: id => http(`/s/users/${id}`),
    search: q => http('/s/search', { query: { q } }),
    getWithAuth: path => naiveAuth(http, ctx, path),
    getWithDeadline: path => http(path),
    getValidated: path => http(path),
  }
}

function createConfigured({ baseUrl, auth }) {
  const http = ofetch.create({
    baseURL: baseUrl,
    // `timeout`: README "Timeout" (DOCS.timeout). Disabled by default.
    timeout: 3000,
    // `parseResponse: JSON.parse`: README "Parsing Response" (DOCS.parsing). The default
    // parser (destr) falls back to the raw text when JSON is invalid; JSON.parse throws.
    parseResponse: JSON.parse,
  })

  // hand-written: abort the previous search when a new one starts. `signal` is a fetch option
  // ofetch passes through (DOCS.abort); the ofetch README has no cancellation section.
  let searchController = null
  function search(q) {
    searchController?.abort()
    searchController = new AbortController()
    return http('/s/search', { query: { q }, signal: searchController.signal })
  }

  // The README documents the interceptor hooks (DOCS.interceptors) and the retry options
  // (DOCS.retry) but shows no token-refresh pattern. hand-written: `onRequest` sets the bearer
  // token, `onResponseError` refreshes on 401 (one shared refresh promise), and
  // `retry: 1, retryStatusCodes: [401]` makes ofetch send the request again, which runs
  // `onRequest` again with the new token.
  let refreshing = null
  const authed = http.create({
    retry: 1,
    retryStatusCodes: [401],
    onRequest({ options }) {
      options.headers = new Headers(options.headers)
      options.headers.set('authorization', `Bearer ${auth.access}`)
    },
    async onResponseError({ options, response }) {
      if (response.status !== 401) return
      const sentWith = options.headers.get('authorization')
      if (sentWith !== `Bearer ${auth.access}`) return
      refreshing ??= http('/s/refresh', { method: 'POST', body: { token: auth.refresh } })
        .then(t => { Object.assign(auth, t) })
        .finally(() => { refreshing = null })
      await refreshing.catch(() => {})
    },
  })

  return {
    getJson: path => http(path),
    getUser: id => http(`/s/users/${id}`),
    search,
    getWithAuth: path => authed(path),
    // `timeout` + `retry` (DOCS.timeout, DOCS.retry). 503 is in the default retryStatusCodes.
    // ofetch's `timeout` is per attempt; it has no overall-deadline option. hand-written: an
    // overall deadline via `signal: AbortSignal.timeout(3000)`, a fetch option ofetch passes
    // through (DOCS.abortTimeout), the same deadline the fetch contender gets. ofetch ignores
    // `timeout` when a `signal` is given.
    getWithDeadline: path => http(path, { timeout: 3000, retry: 3, signal: AbortSignal.timeout(3000) }),
    // getValidated: no built-in option.
  }
}

export default {
  name: 'ofetch',
  version: pkg.version,
  variants: {
    default: { create: createDefault, notes: { getWithAuth: 'hand-written: naive refresh on 401, retry once' } },
    configured: { create: createConfigured, notes: {
      getJson: `timeout: 3000 (${DOCS.timeout}); parseResponse: JSON.parse (${DOCS.parsing})`,
      search: `hand-written: abort the previous call with signal + AbortController (${DOCS.abort}); signal is a fetch option passed through; the ofetch README has no cancellation section`,
      getWithAuth: `hand-written: refresh in onResponseError (${DOCS.onResponseError}) + retry: 1, retryStatusCodes: [401] (${DOCS.retry}), one shared refresh promise`,
      getWithDeadline: `retry: 3 (${DOCS.retry}); hand-written: overall deadline via signal: AbortSignal.timeout(3000) (${DOCS.abortTimeout}). ofetch's \`timeout\` is per attempt; it has no overall-deadline option (${DOCS.timeout})`,
      getValidated: 'no built-in option',
    } },
  },
}
