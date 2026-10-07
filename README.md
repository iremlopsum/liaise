# liaise

*lee-AYZ* — to act as the link between two parties.

**Your API calls, minus the surprises.**

Type-safe REST and GraphQL on plain fetch. Never throws. Zero dependencies. Works with any framework.

[![npm](https://img.shields.io/npm/v/liaise)](https://www.npmjs.com/package/liaise) [![CI](https://github.com/iremlopsum/liaise/actions/workflows/ci.yml/badge.svg)](https://github.com/iremlopsum/liaise/actions/workflows/ci.yml) ![6.2 kB gzipped](https://img.shields.io/badge/gzipped-6.2%20kB-blue) ![MIT](https://img.shields.io/badge/license-MIT-blue)

```bash
npm install liaise
```

**[Documentation](https://iremlopsum.github.io/liaise/)** · [Playground](https://iremlopsum.github.io/liaise/playground/) · [How it compares](https://iremlopsum.github.io/liaise/compare/)

Formerly published as `@iremlopsum/apify`; switching takes two steps, see [MIGRATION.md](./MIGRATION.md#upgrading-to-500).

## The problem it solves

`fetch` is a good building block. Every project still ends up writing the same few things around it, and they are easy to get subtly wrong.

| With plain fetch | liaise | See |
| ---------------- | ------ | --- |
| Typing fast in a search box shows old results. A slow early search lands last. | `dedupe` cancels the older call. | [Stale requests](https://iremlopsum.github.io/liaise/guide/cancelling-deadlines-and-stale-requests/#drop-stale-calls-with-dedupe) |
| Five components load the same data, or five 401s each refresh the token. That's five identical requests. | `share` sends one and hands everyone the answer. | [Sharing identical requests](https://iremlopsum.github.io/liaise/guide/sharing-identical-requests/) |
| A 500 counts as success, offline throws, a hung server waits forever. | Every call returns `{ data, error }`, and `error.kind` names the failure. With `timeout` set, a hung server becomes an error too. | [Handling errors](https://iremlopsum.github.io/liaise/guide/handling-errors/) |
| Retries run straight past your timeout. | `timeout` covers the whole operation, retries included. | [Deadlines](https://iremlopsum.github.io/liaise/guide/cancelling-deadlines-and-stale-requests/#set-a-deadline-with-timeout) |
| The backend changes a field and the page crashes three components later. | A schema checks the response. A bad shape is an error you handle. | [Validating responses](https://iremlopsum.github.io/liaise/guide/validating-responses/) |

[The problem it solves](https://iremlopsum.github.io/liaise/start/the-problem-it-solves/) shows one form submit written both ways.

## Quick start

Define two endpoints, create a client, and make a call.

<!-- tested: quick-start -->
```ts
import { createApi, defineRequest } from 'liaise'

type User = { id: string; name: string; email: string }

// 1. Describe your endpoints. The path decides which params are required.
const getUser = defineRequest<User>()({ method: 'GET', path: '/users/:id' })
const createUser = defineRequest<User, { name: string; email: string }>()({
  method: 'POST',
  path: '/users',
})

// 2. Create the client.
const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUser, createUser },
})

// 3. Call it. This never throws: you always get { data, error }.
const { data, error } = await api.getUser({ id: '42' })

if (error) {
  // error.kind says what went wrong: 'http', 'network', 'timeout', ...
  console.error(error.kind, error.status)
} else {
  console.log(data.name) // data is a User here
}
```

### What you just got

- The params are checked against the path, so `getUser({ userId: '42' })` is a compile error.
- `data` is typed from `defineRequest<User>`.
- Nothing throws, not even when you're offline.
- Checking `error` first narrows `data` to `User`, so you never write `data!`.

Try it without installing anything in the [playground](https://iremlopsum.github.io/liaise/playground/).

## Documentation

Everything else lives on the docs site, **[iremlopsum.github.io/liaise](https://iremlopsum.github.io/liaise/)**, with search.

- **[Getting started](https://iremlopsum.github.io/liaise/start/the-problem-it-solves/):** the problem it solves, the quick start, and how the pieces fit together.
- **[Guide](https://iremlopsum.github.io/liaise/guide/defining-endpoints/):** defining endpoints, handling errors, sending data, reading and validating responses, deadlines and stale requests, sharing identical requests, retries, caching and logging, middleware, pagination, GraphQL, and testing your code.
- **[Recipes](https://iremlopsum.github.io/liaise/recipes/add-an-auth-header-and-refresh-the-token-on-a-401/):** a token refresh on 401, search as you type, TanStack Query, React, a store, server loaders, a flaky backend, per-attempt timeouts, Sentry, and file uploads and downloads.
- **[Choosing liaise](https://iremlopsum.github.io/liaise/choosing/when-it-fits-and-when-it-doesnt/):** when it fits and when it doesn't, [how it compares](https://iremlopsum.github.io/liaise/compare/) with axios, ky and ofetch, and where it runs.
- **[Reference](https://iremlopsum.github.io/liaise/reference/createapi-options/):** every option, `Result` and `ApiError`, middleware context, `liaise/testing`, the exports, and behaviour in detail.

The docs cover the latest version. For 5.1.1 and earlier, the README at that version's tag is the full documentation, for example the [README at 5.1.1](https://github.com/iremlopsum/liaise/blob/v5.1.1/README.md).

## Upgrading, contributing, licence

- **Upgrading.** [MIGRATION.md](./MIGRATION.md) says what to change when an upgrade needs it. [CHANGELOG.md](./CHANGELOG.md) lists every release.
- **Contributing.** Bug reports, fixes and ideas are welcome. [CONTRIBUTING.md](./CONTRIBUTING.md) explains how to report a bug, run the tests, and the few rules a pull request is checked against.
- **Licence.** MIT, in [LICENSE](./LICENSE).
