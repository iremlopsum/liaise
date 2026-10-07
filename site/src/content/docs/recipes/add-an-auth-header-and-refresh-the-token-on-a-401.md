---
title: "Add an auth header and refresh the token on a 401"
order: 1
---
With rotating refresh tokens, five requests that all get a 401 at once must not refresh five times: the first refresh invalidates the token the other four send, and the user is logged out.

<!-- tested: auth-refresh -->
```ts
import { createApi, defineRequest, type Middleware } from 'liaise'

type Tokens = { access: string; refresh: string }
type Order = { id: string; total: number }

let tokens: Tokens = { access: 'expired', refresh: 'r1' }

const auth: Middleware = async (ctx, next) => {
  if (ctx.requestName === 'refresh') return next()

  const sentWith = tokens.access
  ctx.request.headers.set('Authorization', `Bearer ${sentWith}`)
  const result = await next()
  if (result.error?.status !== 401) return result

  // Refresh only if nobody has done it since this call was sent. Every call
  // that gets here at the same moment joins one refresh request (share: true).
  if (tokens.access === sentWith) {
    const refreshed = await api.refresh({ token: tokens.refresh })
    if (refreshed.error) return result // refresh failed: keep the 401
    tokens = refreshed.data
  }
  ctx.request.headers.set('Authorization', `Bearer ${tokens.access}`)
  return next() // send the call again with the new token
}

const api = createApi({
  baseUrl: '/api',
  middleware: [auth],
  requests: {
    refresh: defineRequest<Tokens, { token: string }>()({
      method: 'POST',
      path: '/auth/refresh',
      share: true,
    }),
    getOrders: defineRequest<Order[]>()({ method: 'GET', path: '/orders' }),
  },
})
```

`share: true` on `refresh` is what makes the five calls wait for one refresh. The `requestName` check stops the refresh call from passing through its own middleware.
