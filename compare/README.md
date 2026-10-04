# compare

The harness behind the comparison table in liaise's README. It runs five HTTP clients
(plain `fetch`, axios, ky, ofetch and liaise) through ten failure scenarios against a local
server, and records what the calling code receives.

This folder is not part of the published package. It has its own `package.json` and its own
dependencies, pinned to exact versions.

## Run it

```bash
# in the repo root: liaise is installed from ../dist
npm run build

cd compare
npm install
npm test                    # the outcome classifier's own test
npm run compare:behaviour   # writes results.json
```

## What is measured

Each contender has two variants.

- `default` calls the library the most obvious way, with no options set.
- `configured` uses only options and patterns from the library's own docs. The doc source
  sits in a comment above each option and in that method's `notes`.

Code beyond the docs is allowed only where a scenario can't be done otherwise, and is
labelled `hand-written: <what>`. A capability a library doesn't have is left out (`—` in the
table) and labelled `no built-in option`.

## Files

- `server.mjs`: the test server. Each scenario run gets a fresh one.
- `scenarios.mjs`: the ten scenarios.
- `observe.mjs`: turns whatever a call returns or throws into one fixed vocabulary
  (`data`, `wrong data`, `throws <name>`, `error result (<kind>)`, `still waiting after Ns`).
- `contenders/*.mjs`: one module per library, with both variants.
- `run.mjs`: runs everything and writes `results.json`, the dated record the README cites.
