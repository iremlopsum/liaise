import ky from 'ky'
import { readFileSync } from 'node:fs'

// Doc source: the readme shipped in node_modules/ky (2.1.0), the same text as
// https://github.com/sindresorhus/ky/blob/v2.1.0/readme.md
const pkg = JSON.parse(readFileSync(new URL('../node_modules/ky/package.json', import.meta.url), 'utf8'))
const README = 'https://github.com/sindresorhus/ky/blob/v2.1.0/readme.md'
const DOCS = {
  json: `${README}#kyinput-options`,
  timeout: `${README}#timeout`,
  totalTimeout: `${README}#totaltimeout`,
  retry: `${README}#retry`,
  parseJson: `${README}#parsejson`,
  cancel: `${README}#cancellation`,
  beforeRetry: `${README}#hooksbeforeretry`,
  faqAuth: `${README}#how-do-i-add-authentication-headers-to-every-request`,
  faqRefresh: `${README}#how-do-i-implement-token-refresh-on-401-responses`,
}

// Standard Schema, hand-built so the harness needs no validator dependency.
// The same object liaise's contender uses.
const userSchema = {
  '~standard': { version: 1, vendor: 'compare', validate: v =>
    v && typeof v.id === 'string' && typeof v.name === 'string' ? { value: v } : { issues: [{ message: 'name must be a string' }] } },
}

/** The naive refresh every library's default variant uses: on 401, POST the refresh token, retry once. */
async function naiveAuth(http, { auth }, path) {
  const is401 = e => e?.response?.status === 401
  const get = token => http.get(path, { headers: { authorization: `Bearer ${token}` } }).json()
  const post = body => http.post('/s/refresh', { json: body }).json()
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
  // ky.create({ baseUrl }) only so paths resolve against the test server.
  const http = ky.create({ baseUrl: ctx.baseUrl })
  return {
    getJson: path => http.get(path).json(),
    getUser: id => http.get(`/s/users/${id}`).json(),
    search: q => http.get('/s/search', { searchParams: { q } }).json(),
    getWithAuth: path => naiveAuth(http, ctx, path),
    getWithDeadline: path => http.get(path).json(),
    getValidated: path => http.get(path).json(),
  }
}

function createConfigured({ baseUrl, auth }) {
  const http = ky.create({
    baseUrl,
    // `timeout`: per-attempt timeout (DOCS.timeout). The default is 10000.
    timeout: 3000,
    // `parseJson`: the readme's `ky()` section says ".json() will throw if the body is empty
    // ... you can use the parseJson option to add custom handling for empty bodies" (DOCS.json,
    // DOCS.parseJson). The empty-body branch is the custom handling it describes.
    parseJson: text => (text === '' ? undefined : JSON.parse(text)),
  })

  // hand-written: abort the previous search when a new one starts. `signal`: readme
  // "Cancellation" (DOCS.cancel).
  let searchController = null
  function search(q) {
    searchController?.abort()
    searchController = new AbortController()
    return http.get('/s/search', { searchParams: { q }, signal: searchController.signal }).json()
  }

  // Token refresh, following the readme's FAQ "How do I implement token refresh on 401
  // responses?" (DOCS.faqRefresh): `retry: { statusCodes: [401] }` plus a `beforeRetry` hook
  // (DOCS.beforeRetry) that calls a user-supplied `refreshToken()` and sets the new header.
  // The bearer is set first in `hooks.beforeRequest`, the readme's FAQ "How do I add
  // authentication headers to every request?" (DOCS.faqAuth).
  // hand-written: `refreshToken()` shares one in-flight promise, and skips the refresh when
  // another call already replaced the token this request was sent with. This is the same
  // guard the fetch, axios and ofetch contenders get.
  let refreshing = null
  function refreshToken() {
    refreshing ??= ky.post(`${baseUrl}/s/refresh`, { json: { token: auth.refresh } }).json()
      .then(t => { Object.assign(auth, t) })
      .finally(() => { refreshing = null })
    return refreshing
  }
  const authed = http.extend({
    retry: { statusCodes: [401] },
    hooks: {
      beforeRequest: [({ request }) => { request.headers.set('authorization', `Bearer ${auth.access}`) }],
      beforeRetry: [
        async ({ request }) => {
          if (request.headers.get('authorization') === `Bearer ${auth.access}`) await refreshToken()
          request.headers.set('authorization', `Bearer ${auth.access}`)
        },
      ],
    },
  })

  return {
    getJson: path => http.get(path).json(),
    getUser: id => http.get(`/s/users/${id}`).json(),
    search,
    getWithAuth: path => authed.get(path).json(),
    // `totalTimeout` is the readme's overall deadline "for the entire operation, including
    // retries and delays" (DOCS.totalTimeout); `retry.limit` (DOCS.retry). 503 is in the
    // default `retry.statusCodes`.
    getWithDeadline: path => http.get(path, { timeout: 3000, totalTimeout: 3000, retry: { limit: 3 } }).json(),
    // `.json(schema)` validates with any Standard Schema and throws SchemaValidationError (DOCS.json).
    getValidated: path => http.get(path).json(userSchema),
  }
}

export default {
  name: 'ky',
  version: pkg.version,
  variants: {
    default: { create: createDefault, notes: { getWithAuth: 'hand-written: naive refresh on 401, retry once' } },
    configured: { create: createConfigured, notes: {
      getJson: `timeout: 3000 (${DOCS.timeout}); parseJson handles an empty body (${DOCS.parseJson})`,
      search: `hand-written: abort the previous call with signal + AbortController (${DOCS.cancel})`,
      getWithAuth: `hand-written: one shared refresh promise in beforeRetry (readme FAQ: token refresh, ${DOCS.faqRefresh})`,
      getWithDeadline: `timeout: 3000, totalTimeout: 3000, retry: { limit: 3 } (${DOCS.totalTimeout}, ${DOCS.retry})`,
      getValidated: `.json(schema), Standard Schema (${DOCS.json})`,
    } },
  },
}
