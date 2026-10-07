// Smoke-tests a freshly installed liaise. The release workflow copies this file
// into a directory where `npm install liaise@<version>` ran and runs it there:
// inside the repo, import('liaise') would resolve to the repo itself (a package
// may import its own name), which would test the source, not the tarball.
//
// Usage (from the install directory): node smoke-installed.mjs <expected-version>
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const expected = process.argv[2]
assert.ok(expected, 'usage: node smoke-installed.mjs <expected-version>')

const pkgDir = new URL('./node_modules/liaise/', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', pkgDir), 'utf8'))
assert.equal(pkg.version, expected, 'installed version')
assert.deepEqual(
  readdirSync(pkgDir).sort(),
  ['CHANGELOG.md', 'LICENSE', 'MIGRATION.md', 'README.md', 'dist', 'package.json'],
  'tarball contents (package.json "files")',
)

const core = await import('liaise')
const middleware = await import('liaise/middleware')
const testing = await import('liaise/testing')
for (const [name, value] of Object.entries({
  createApi: core.createApi, defineRequest: core.defineRequest, createGraphQL: core.createGraphQL,
  retryMiddleware: middleware.retryMiddleware, logMiddleware: middleware.logMiddleware, cacheMiddleware: middleware.cacheMiddleware,
  mockFetch: testing.mockFetch, jsonResponse: testing.jsonResponse,
})) assert.equal(typeof value, 'function', `export ${name}`)

const mock = testing.mockFetch({ 'GET /users/:id': testing.jsonResponse({ id: '1', name: 'Ada' }) })
mock.install()
try {
  const getUser = core.defineRequest()({ method: 'GET', path: '/users/:id' })
  const api = core.createApi({ baseUrl: 'https://api.test', requests: { getUser } })
  const { data, error } = await api.getUser({ id: '1' })
  assert.equal(error, null, 'a successful call has error: null')
  assert.equal(data.name, 'Ada', 'the call returns the mocked body')
} finally {
  mock.restore()
}
console.log(`smoke: liaise@${expected} installs, imports all three entry points and makes a call`)
