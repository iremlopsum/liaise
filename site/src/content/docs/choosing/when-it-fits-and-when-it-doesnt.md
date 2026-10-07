---
title: "When it fits, and when it doesn't"
order: 1
---
Need a normalized cache (update one user, and every screen showing that user updates), optimistic updates or subscriptions? Use Apollo or urql. Apollo's [caching overview](https://www.apollographql.com/docs/react/caching/overview) and urql's [Graphcache docs](https://nearform.com/open-source/urql/docs/graphcache/) explain how each one caches. [Why another API client?](/start/the-problem-it-solves/#why-another-api-client) covers the trade-off.

For UI caching and refetching, use TanStack Query *with* liaise; see the [recipe](/recipes/use-with-tanstack-query/).

For two or three calls, plain fetch is fine.

liaise is a good fit when you have:

- **Many endpoints with one auth setup.** Each endpoint is one [`defineRequest`](/guide/defining-endpoints/), and one [auth middleware](/recipes/add-an-auth-header-and-refresh-the-token-on-a-401/) covers them all.
- **Failure handling that matters**, such as a checkout or a form. Every failure comes back as a value with a [kind you can switch on](/guide/handling-errors/).
- **One API layer shared across frameworks, servers and scripts.** See [Where it runs](/choosing/where-it-runs/).
