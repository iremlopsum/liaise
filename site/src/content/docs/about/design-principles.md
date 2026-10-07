---
title: "Design principles"
order: 1
---
## Never throws

A thrown error doesn't show up in a function's type, so nothing reminds you to catch it, and one missed `try` breaks the page. A returned error is part of the type. TypeScript makes you check `error` before you can read `data`, and every failure arrives in the same shape.

## Zero dependencies

Every dependency of liaise would also be a dependency of your app, with more to download, audit and update. liaise uses only what the runtime already has: `fetch`, `Headers`, `AbortController` and the other web types. Validators plug in through Standard Schema, which is only an interface, so schema support adds no package either. The size of each entry point is under [Exports](/reference/exports/).

## Middleware over interceptors

Separate request and response interceptors split one job in two. State both halves need rides on the request config, and resending means calling the client again from inside a hook. A middleware wraps the whole call, so one function can set a header, read the result, retry, or answer from a cache. The built-in `retryMiddleware`, `cacheMiddleware` and `logMiddleware` are ordinary middleware, so anything they do, yours can do too.

## Types by inference

Types you write at each call site drift away from the endpoint they describe. In liaise you write the types once, on the endpoint, and the path supplies the path params. `createApi` carries them to every call, so a renamed param or a changed response is a compile error where it is used.

## Any runtime

liaise needs only `fetch` and the standard web types, so one client works in a browser, on a server, in a worker or in a script. Code that moves between them needs no second client and no adapter. [Where it runs](/choosing/where-it-runs/) lists what CI tests.

## Any framework

A client is a plain object of functions that return promises. That fits every UI framework, and code with no framework at all, and there is nothing to rewrite when you switch. Query libraries expect a failed call to throw, so you convert at that one edge, as the [TanStack Query recipe](/recipes/use-with-tanstack-query/) does.
