# Contributing to liaise

Thanks for helping. Bug reports, small fixes, docs corrections and ideas are all welcome.

## Reporting a bug

[Open a bug report](https://github.com/iremlopsum/liaise/issues/new?template=bug_report.yml). The most useful thing you can include is a **small piece of code that shows the problem**: the `Request` definition, the call, what you expected, and what you got. If it only happens on one runtime (a browser, Node, Bun, Deno, a Worker, React Native), say which one and which version.

## Suggesting a feature

[Open a feature request](https://github.com/iremlopsum/liaise/issues/new?template=feature_request.yml) and start with the problem you're trying to solve, not the API you'd like. liaise deliberately stays small, so a problem that can't be solved with middleware or a few lines of your own code has the best chance.

## Working on the code

You need Node 20 or newer.

```bash
git clone https://github.com/iremlopsum/liaise.git
cd liaise
npm ci
npm run test              # tests in watch mode
```

Before opening a pull request, run what CI runs:

```bash
npm run typecheck         # TypeScript, library source
npm run test:types        # type-level tests
npm run test:run          # all tests once, including integration
npm run test:integration  # integration tests against a real local HTTP server
npm run docs:check        # README examples match the tests they come from
npm run docs:types        # every other TypeScript example in the docs type-checks
npm run build
```

## Working on the docs

The docs site lives in `site/` and is published at https://iremlopsum.github.io/liaise/. It
needs Node 22.12 or newer (the library itself needs 20). It uses the library you just built, so
build that first:

```bash
npm run build                  # the library, into dist/
npm ci --prefix site
npm --prefix site run dev      # http://localhost:4321/liaise/
npm --prefix site run build && npm --prefix site test   # what CI runs for the site
```

Pages are in `site/src/content/docs/`, one folder per sidebar group. Each page starts with
frontmatter giving its `title`, a one-sentence `description` (used in search results), and an
`order` that sets its place in the sidebar.

- **Runnable examples come from tests.** A page shows one with `<Example name="…" />`, which
  renders the region between `// example:<name>:start` and `:end` in a test under `tests/`. To
  change an example, change the test, run it, then check the page. The README's quick start is
  a copy of its region, and `npm run docs:check` fails when the copy drifts.
- **Every other TypeScript block must type-check** (`npm run docs:types`). If a block is
  deliberately incomplete, put a marker with the reason just before it: `<!-- untyped: reason -->`
  in Markdown, `{/* untyped: reason */}` in MDX.
- **Links between pages** are written without the `/liaise` prefix (`/guide/handling-errors/`).
  The build adds it, and the site tests fail on any link that goes nowhere.
- **The README is the front page:** the pitch, install, the quick start and links to the docs. It
  changes only when one of those does.

## The rules that matter

These are the ones a pull request gets checked against.

- **No runtime dependencies.** Anything liaise depends on ends up in every user's bundle. If a change needs a library, it probably belongs in user code or middleware instead.
- **Never throw.** Every public call returns a `Result` (`{ data, error }`), even when the network fails or the code inside a middleware throws. The single exception is a configuration mistake caught when `createApi` is called.
- **Every fix comes with a test, and the test must fail without the fix.** Undo your fix, run the test, check that it fails because of the bug (an assertion error, not a crash from missing code), then put the fix back.
- **Docs change with the code.** If your change affects anything a user calls, passes or gets back, update its page in `site/src/content/docs/` in the same pull request.
- **Leave the version alone.** `package.json` version, `CHANGELOG.md` and `MIGRATION.md` are updated by the maintainer when a release is cut.
- **Commit messages carry no tool attribution.** No `Co-Authored-By:` lines naming an AI tool and no "Generated with" lines. CI rejects them.

## Code style

Match the code around your change: ESM with `.js` extensions on internal imports (even in `.ts` files), strict TypeScript, and comments that explain why, not what. When in doubt, a smaller change is easier to review.

## Releases

Releases are automated and maintainer-only. A release is a pull request that bumps the version in `package.json` (with `npm version <version> --no-git-tag-version`) and adds the matching `CHANGELOG.md` entry, with its compare link at the bottom, and a `MIGRATION.md` entry when upgrading needs action. CI checks those on the pull request. Once the maintainer merges it and approves the deployment, GitHub Actions publishes to npm with provenance, checks the published package from a fresh install, then tags the release and creates the GitHub Release from the CHANGELOG entry. Contributors never need to bump the version; the maintainer does it in a release PR.
