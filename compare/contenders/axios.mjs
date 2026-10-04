import axios from 'axios'
import { readFileSync } from 'node:fs'

// Doc sources: the README shipped in node_modules/axios (1.20.0), which is the
// same text as https://github.com/axios/axios/blob/v1.20.0/README.md
const pkg = JSON.parse(readFileSync(new URL('../node_modules/axios/package.json', import.meta.url), 'utf8'))
const DOCS = {
  config: 'https://github.com/axios/axios/blob/v1.20.0/README.md#request-config',
  timeouts: 'https://github.com/axios/axios/blob/v1.20.0/README.md#handling-timeouts',
  cancel: 'https://github.com/axios/axios/blob/v1.20.0/README.md#abortcontroller',
  interceptors: 'https://github.com/axios/axios/blob/v1.20.0/README.md#interceptors',
}

/** The naive refresh every library's default variant uses: on 401, POST the refresh token, retry once. */
async function naiveAuth(http, { auth }, path) {
  const is401 = e => e?.response?.status === 401
  const get = token => http.get(path, { headers: { authorization: `Bearer ${token}` } }).then(r => r.data)
  const post = body => http.post('/s/refresh', body).then(r => r.data)
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
  // axios.create({ baseURL }) only so paths resolve against the test server.
  const http = axios.create({ baseURL: ctx.baseUrl })
  return {
    getJson: path => http.get(path).then(r => r.data),
    getUser: id => http.get(`/s/users/${id}`).then(r => r.data),
    search: q => http.get('/s/search', { params: { q } }).then(r => r.data),
    getWithAuth: path => naiveAuth(http, ctx, path),
    getWithDeadline: path => http.get(path).then(r => r.data),
    getValidated: path => http.get(path).then(r => r.data),
  }
}

function createConfigured({ baseUrl, auth }) {
  const http = axios.create({
    baseURL: baseUrl,
    // `timeout`: README "Request config" and "Handling timeouts" (DOCS.config, DOCS.timeouts).
    timeout: 3000,
    // Throw on invalid JSON instead of handing back the raw string. README "Request config",
    // `transitional.silentJSONParsing`: "To have invalid JSON throw errors, use:
    // { responseType: 'json', transitional: { silentJSONParsing: false } }" (DOCS.config).
    responseType: 'json',
    transitional: { silentJSONParsing: false },
  })

  // hand-written: abort the previous search when a new one starts. `signal`: README
  // "Cancellation > AbortController" (DOCS.cancel).
  let searchController = null
  function search(q) {
    searchController?.abort()
    searchController = new AbortController()
    return http.get('/s/search', { params: { q }, signal: searchController.signal }).then(r => r.data)
  }

  // Request interceptor sets the bearer token; response interceptor refreshes on 401 and
  // retries once. The interceptor API is documented (DOCS.interceptors); the refresh logic
  // is hand-written, with one shared refresh promise so concurrent 401s wait for it.
  const authed = axios.create({ baseURL: baseUrl, timeout: 3000 })
  authed.interceptors.request.use(config => {
    config.headers.set('authorization', `Bearer ${auth.access}`)
    return config
  })
  let refreshing = null
  authed.interceptors.response.use(undefined, async error => {
    const config = error.config
    if (error.response?.status !== 401 || config._retried) throw error
    config._retried = true
    const sentWith = config.headers.get('authorization')
    if (sentWith === `Bearer ${auth.access}`) {
      refreshing ??= http.post('/s/refresh', { token: auth.refresh })
        .then(r => { Object.assign(auth, r.data) })
        .finally(() => { refreshing = null })
      await refreshing
    }
    return authed.request(config)
  })

  return {
    getJson: path => http.get(path).then(r => r.data),
    getUser: id => http.get(`/s/users/${id}`).then(r => r.data),
    search,
    getWithAuth: path => authed.get(path).then(r => r.data),
    // hand-written: loop of up to 4 attempts under one AbortSignal.timeout(3000); axios has no
    // built-in retry. `signal` is documented under "Cancellation > AbortController" (DOCS.cancel).
    getWithDeadline: async path => {
      const signal = AbortSignal.timeout(3000)
      for (let attempt = 0; ; attempt++) {
        try {
          return (await http.get(path, { signal })).data
        } catch (e) {
          if (!(e?.response?.status >= 500) || attempt === 3) throw e
        }
      }
    },
    // getValidated: no built-in option.
  }
}

export default {
  name: 'axios',
  version: pkg.version,
  variants: {
    default: { create: createDefault, notes: { getWithAuth: 'hand-written: naive refresh on 401, retry once' } },
    configured: { create: createConfigured, notes: {
      getJson: `timeout: 3000 (${DOCS.timeouts}); responseType: 'json' + transitional.silentJSONParsing: false (${DOCS.config})`,
      search: `hand-written: abort the previous call with signal + AbortController (${DOCS.cancel})`,
      getWithAuth: `hand-written: refresh in a response interceptor (${DOCS.interceptors}), one shared refresh promise`,
      getWithDeadline: `hand-written: loop of 4 attempts under one AbortSignal.timeout(3000) (${DOCS.cancel})`,
      getValidated: 'no built-in option',
    } },
  },
}
