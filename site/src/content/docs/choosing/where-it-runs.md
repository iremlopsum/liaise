---
title: "Where it runs"
order: 3
---
| Runtime | Status |
| ------- | ------ |
| Node 20, 22, 24 | Tested in CI |
| Browsers, Bun, Deno, Cloudflare Workers | Should work (standard `fetch`), not tested in CI |
| React Native | Uses its built-in `fetch`, not tested in CI |

On React Native, where `AbortSignal.timeout` is missing, `timeout` falls back to a timer. If the runtime drops abort reasons, a timeout may report as `'abort'` instead of `'timeout'`.

No hooks, no framework code: a client is a plain object of functions returning promises. It works in React, Vue, Svelte, Solid, Angular, server loaders, workers and scripts. The [recipes](#recipes) show it with TanStack Query, React and a store.
