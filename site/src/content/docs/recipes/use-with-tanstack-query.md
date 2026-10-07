---
title: "Use with TanStack Query"
order: 3
---
liaise never throws. TanStack Query expects a failing query function to throw, so `unwrap` converts at that one boundary. `api` is the client from [Quick start](/start/quick-start/).

<!-- tested: tanstack-query -->
```ts
import type { Result } from 'liaise'

// TanStack Query expects a failed query to throw. Do it here, at your edge.
async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
  const { data, error } = await call
  if (error) throw error
  return data
}

export const userQuery = (id: string) => ({
  queryKey: ['user', id],
  // TanStack's signal cancels the request when the query is no longer needed.
  queryFn: ({ signal }: { signal: AbortSignal }) => unwrap(api.getUser({ id }, { signal })),
})

// React:  useQuery(userQuery(id))
// Vue:    useQuery(computed(() => userQuery(id.value)))
// Svelte: createQuery(() => userQuery(id))
// Solid:  useQuery(() => userQuery(id()))
```

The same options object works with every TanStack adapter; the comments show the call in each. These comment lines aren't executed by the test.

`error` is the `ApiError` liaise returned, which isn't an `Error` subclass, so it has no `message`. Read `error.kind` and `error.status`. To type it, register `ApiError` as TanStack's `defaultError`.
