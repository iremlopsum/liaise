import { createApi, defineRequest } from 'liaise'
import { retryMiddleware } from 'liaise/middleware'
import { readFileSync } from 'node:fs'

// liaise's `exports` does not expose ./package.json, so read it from disk.
const pkg = JSON.parse(readFileSync(new URL('../node_modules/liaise/package.json', import.meta.url), 'utf8'))

// Doc source: liaise's README. Anchors are for the restructured README on this branch.
const README = 'https://github.com/iremlopsum/liaise/blob/main/README.md'
const DOCS = {
  timeout: `${README}#cancelling-deadlines-and-stale-requests`,
  dedupe: `${README}#drop-stale-calls-with-dedupe`,
  share: `${README}#add-an-auth-header-and-refresh-the-token-on-a-401`,
  responseType: `${README}#reading-responses`,
  schema: `${README}#validating-responses`,
  retry: `${README}#retries-caching-and-logging`,
}

const userSchema = { // Standard Schema, hand-built so the harness needs no validator dependency
  '~standard': { version: 1, vendor: 'compare', validate: v =>
    v && typeof v.id === 'string' && typeof v.name === 'string' ? { value: v } : { issues: [{ message: 'name must be a string' }] } },
}

function make({ baseUrl, auth }, configured) {
  const authMw = async (ctx, next) => {
    if (ctx.requestName === 'refresh') return next()
    const sentWith = auth.access
    ctx.request.headers.set('authorization', `Bearer ${sentWith}`)
    const r = await next()
    if (r.error?.status !== 401) return r
    if (auth.access === sentWith) {
      const t = await api.refresh({ token: auth.refresh })
      if (t.error) return r
      Object.assign(auth, t.data)
    }
    ctx.request.headers.set('authorization', `Bearer ${auth.access}`)
    return next()
  }
  // Configured options: `timeout` (DOCS.timeout), `responseType: 'none'` (DOCS.responseType),
  // `dedupe` (DOCS.dedupe), `share` on the refresh call (DOCS.share, the auth recipe),
  // `retryMiddleware` (DOCS.retry), `schema` (DOCS.schema).
  const api = createApi({
    baseUrl,
    requests: {
      json500: defineRequest()({ method: 'GET', path: '/s/500' }),
      ok: defineRequest()({ method: 'GET', path: '/s/ok' }),
      hang: defineRequest()({ method: 'GET', path: '/s/hang', ...(configured && { timeout: 3000 }) }),
      broken: defineRequest()({ method: 'GET', path: '/s/broken-json' }),
      empty: defineRequest()({ method: 'GET', path: '/s/204', ...(configured && { responseType: 'none' }) }),
      user: defineRequest()({ method: 'GET', path: '/s/users/:id' }),
      search: defineRequest()({ method: 'GET', path: '/s/search', ...(configured && { dedupe: true }) }),
      refresh: defineRequest()({ method: 'POST', path: '/s/refresh', ...(configured && { share: true }) }),
      orders: defineRequest()({ method: 'GET', path: '/s/orders', middleware: [authMw] }),
      slow: defineRequest()({ method: 'GET', path: '/s/slow-503', ...(configured && { timeout: 3000, middleware: [retryMiddleware({ max: 3 })] }) }),
      wrong: defineRequest()({ method: 'GET', path: '/s/user-wrong', ...(configured && { schema: userSchema }) }),
    },
  })
  const byPath = { '/s/500': api.json500, '/s/ok': api.ok, '/s/hang': api.hang, '/s/broken-json': api.broken, '/s/204': api.empty }
  return {
    getJson: path => byPath[path](),
    getUser: id => api.user({ id }),
    search: q => api.search({ q }),
    getWithAuth: () => api.orders(),
    getWithDeadline: () => api.slow(),
    getValidated: () => api.wrong(),
  }
}

export default {
  name: 'liaise',
  version: pkg.version,
  variants: {
    default: { create: ctx => make(ctx, false), notes: { getWithAuth: 'same refresh middleware, without share' } },
    configured: { create: ctx => make(ctx, true), notes: {
      getJson: `timeout: 3000 (${DOCS.timeout}); responseType: 'none' for the 204 (${DOCS.responseType})`,
      search: `dedupe: true (${DOCS.dedupe})`,
      getWithAuth: `share: true on refresh, the README recipe (${DOCS.share})`,
      getWithDeadline: `timeout: 3000 (${DOCS.timeout}) + retryMiddleware({ max: 3 }) (${DOCS.retry})`,
      getValidated: `schema, Standard Schema (${DOCS.schema})`,
    } },
  },
}
