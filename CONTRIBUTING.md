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
npm run build
```

## The rules that matter

These are the ones a pull request gets checked against.

- **No runtime dependencies.** Anything liaise depends on ends up in every user's bundle. If a change needs a library, it probably belongs in user code or middleware instead.
- **Never throw.** Every public call returns a `Result` (`{ data, error }`), even when the network fails or the code inside a middleware throws. The single exception is a configuration mistake caught when `createApi` is called.
- **Every fix comes with a test, and the test must fail without the fix.** Undo your fix, run the test, check that it fails because of the bug (an assertion error, not a crash from missing code), then put the fix back.
- **Docs change with the code.** If your change affects anything a user calls, passes or gets back, update `README.md` in the same pull request.
- **Leave the version alone.** `package.json` version, `CHANGELOG.md` and `MIGRATION.md` are updated by the maintainer when a release is cut.
- **Commit messages carry no tool attribution.** No `Co-Authored-By:` lines naming an AI tool and no "Generated with" lines. CI rejects them.

## Code style

Match the code around your change: ESM with `.js` extensions on internal imports (even in `.ts` files), strict TypeScript, and comments that explain why, not what. When in doubt, a smaller change is easier to review.
