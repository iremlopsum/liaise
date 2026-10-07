# compare

The harness behind liaise's comparison page. It runs five HTTP clients (plain
`fetch`, axios, ky, ofetch and liaise) through ten failure scenarios against a local server,
and records what the calling code receives. It also measures bundle size and request overhead.

This folder is not part of the published package. It has its own `package.json`, with exact
dependency versions.

## Run it

```bash
npm run build            # in the repo root: liaise is installed from ../dist
cd compare && npm install
npm run compare          # behaviour, sizes, overhead, then results.md
```

`npm run compare:behaviour` runs only the scenarios. The docs site's comparison page
(https://iremlopsum.github.io/liaise/compare/) is built from `results.json`, through the same
`cells.mjs` as `results.md`, so a rerun reaches the site with its next deploy.

## Fairness rules

- `default` calls the library the most obvious way, with no options set.
- `configured` uses only options and patterns from the library's own docs. The doc link sits
  in a comment above each option and in that method's `notes`.
- Code beyond the docs is allowed only where a scenario can't be done otherwise. It is
  labelled `hand-written: <what>`, and the table marks it with `*`.
- A capability a library lacks is left out (`—`) and labelled `no built-in option`.
- Every library gets the same hand-written guards (one shared refresh, one abort controller).
- Whatever the run shows is published, including where liaise loses.

## Files

`server.mjs` (test server), `scenarios.mjs`, `observe.mjs` (outcome classifier),
`contenders/*.mjs` (one per library), `run.mjs`, `sizes.mjs`, `overhead.mjs`, `report.mjs`.
`results.json` is the dated record and `results.md` the generated report.

`cells.mjs` is the outcome cell that `report.mjs` prints. The docs site's comparison page
(`site/src/pages/compare.astro`) renders `results.json` through the same file, so it imports
nothing: the site loads it without `compare/node_modules`.

If you maintain one of these libraries and think its file is unfair, a pull request is very
welcome.
