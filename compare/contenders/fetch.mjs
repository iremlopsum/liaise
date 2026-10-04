// Plain fetch, as Node ships it. There is no library, so "configured" means the
// careful code a developer writes by hand on top of the standard APIs. Every
// such piece is labelled `hand-written` in `notes`.

const MDN_OK = 'https://developer.mozilla.org/en-US/docs/Web/API/Response/ok'
const MDN_TIMEOUT = 'https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static'
const MDN_ABORT = 'https://developer.mozilla.org/en-US/docs/Web/API/AbortController'

const json = (url, init) => fetch(url, init).then(r => r.json())

/** The naive refresh every library's default variant uses: on 401, POST the refresh token, retry once. */
function naiveAuth({ baseUrl, auth }, path) {
  const get = token => fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } })
  const post = body => json(`${baseUrl}/s/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return (async () => {
    const first = await get(auth.access)
    if (first.status !== 401) return first.json()
    const t = await post({ token: auth.refresh })
    Object.assign(auth, t)
    return (await get(auth.access)).json()
  })()
}

function createDefault(ctx) {
  const { baseUrl } = ctx
  return {
    getJson: path => json(`${baseUrl}${path}`),
    getUser: id => json(`${baseUrl}/s/users/${id}`),
    search: q => json(`${baseUrl}/s/search?q=${encodeURIComponent(q)}`),
    getWithAuth: path => naiveAuth(ctx, path),
    getWithDeadline: path => json(`${baseUrl}${path}`),
    getValidated: path => json(`${baseUrl}${path}`),
  }
}

function createConfigured({ baseUrl, auth }) {
  // Response.ok: MDN_OK. AbortSignal.timeout(): MDN_TIMEOUT.
  async function request(url, init = {}) {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000), ...init })
    if (!res.ok) {
      const e = new Error(`HTTP ${res.status}`)
      e.status = res.status
      throw e
    }
    // hand-written: a 204 has no body, so do not parse one.
    return res.status === 204 ? undefined : res.json()
  }

  // hand-written: abort the previous search when a new one starts (MDN_ABORT).
  let searchController = null
  function search(q) {
    searchController?.abort()
    searchController = new AbortController()
    return request(`${baseUrl}/s/search?q=${encodeURIComponent(q)}`, { signal: searchController.signal })
  }

  // hand-written: one refresh in flight at a time; concurrent 401s wait for it.
  let refreshing = null
  function refresh() {
    refreshing ??= request(`${baseUrl}/s/refresh`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: auth.refresh }),
    }).then(t => { Object.assign(auth, t) }).finally(() => { refreshing = null })
    return refreshing
  }
  async function getWithAuth(path) {
    const sentWith = auth.access
    try {
      return await request(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${sentWith}` } })
    } catch (e) {
      if (e.status !== 401) throw e
      if (auth.access === sentWith) await refresh()
      return request(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${auth.access}` } })
    }
  }

  // hand-written: up to 4 attempts (1 + 3 retries) on 5xx, all under one 3 s deadline.
  async function getWithDeadline(path) {
    const signal = AbortSignal.timeout(3000)
    for (let attempt = 0; ; attempt++) {
      try {
        return await request(`${baseUrl}${path}`, { signal })
      } catch (e) {
        if (!(e.status >= 500) || attempt === 3) throw e
      }
    }
  }

  return {
    getJson: path => request(`${baseUrl}${path}`),
    getUser: id => request(`${baseUrl}/s/users/${id}`),
    search,
    getWithAuth,
    getWithDeadline,
    // getValidated: no built-in option.
  }
}

export default {
  name: 'fetch',
  version: process.version,
  variants: {
    default: { create: createDefault, notes: { getWithAuth: 'hand-written: naive refresh on 401, retry once' } },
    configured: { create: createConfigured, notes: {
      getJson: `hand-written: res.ok check that throws (${MDN_OK}), signal: AbortSignal.timeout(3000) (${MDN_TIMEOUT}), skip parsing a 204`,
      getUser: 'hand-written: template string, same as default',
      search: `hand-written: abort the previous call with AbortController (${MDN_ABORT})`,
      getWithAuth: 'hand-written: one shared refresh promise, retry once',
      getWithDeadline: `hand-written: loop of 4 attempts under one AbortSignal.timeout(3000) (${MDN_TIMEOUT})`,
      getValidated: 'no built-in option',
    } },
  },
}
