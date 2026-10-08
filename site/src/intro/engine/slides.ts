// The intro's nine slide scripts: what gets typed, when the editor's hints appear, and the
// caption for each moment. site/tests/intro-slides.test.ts checks that each script ends on its
// SOURCES files, keeps to 66 columns and has a caption for every cue; `npm run docs:types`
// compiles SOURCES against liaise (through ../files.ts).
import type { CompletionItem, SlideScript } from './timeline'
import { compile } from './timeline'

const API_TS = `import { createApi, defineRequest } from 'liaise'

// What the server sends back
export type User = { id: string; name: string; email: string }

// What a search sends
type SearchParams = { q: string }

// GET /users/:id returns one User
const getUser = defineRequest<User>()({
  method: 'GET',
  path: '/users/:id',
})

// GET /users?q=ada returns a list of them
const searchUsers = defineRequest<User[], SearchParams>()({
  method: 'GET',
  path: '/users',
})

export const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUser, searchUsers },
})
`

const PROFILE_TS = `import { api } from './api'

const { data, error } = await api.getUser({ id: '42' })

if (error) {
  console.log(error.kind)
} else {
  console.log(data.name)
}
`

const SEARCH_TSX = `import { useState } from 'react'
import { api, type User } from './api'

export function Search() {
  const [q, setQ] = useState('')
  const [people, setPeople] = useState<User[]>([])

  async function search(text: string) {
    setQ(text)
    const { data, error } = await api.searchUsers({ q: text })
    if (error?.kind === 'abort') return // a newer keystroke won
    if (data) setPeople(data)
  }

  return (
    <>
      <input
        value={q}
        placeholder="Search people"
        onChange={e => search(e.target.value)}
      />
      <ul>{people.map(p => <li key={p.id}>{p.name}</li>)}</ul>
    </>
  )
}
`

const DEDUPE_LINE = `
  dedupe: true,`

/** Splits `text` at each marker so a script can type it in pieces. */
function cut(text: string, ...markers: string[]): string[] {
  const parts: string[] = []
  let rest = text
  for (const m of markers) {
    const i = rest.indexOf(m)
    if (i < 0) throw new Error(`marker not found: ${m}`)
    parts.push(rest.slice(0, i + m.length))
    rest = rest.slice(i + m.length)
  }
  parts.push(rest)
  return parts
}

const API_HOVER = `const api: {
  getUser: (params: { id: string | number }, options?: CallOptions) => Promise<Result<User>>
  searchUsers: (params: SearchParams, options?: CallOptions) => Promise<Result<User[]>>
}`

// Slide 1: the setup ---------------------------------------------------------
const [s1Import, s1Output, s1Input, s1Get, s1Search, s1Client] =
  cut(API_TS, `'liaise'\n\n`, `email: string }\n\n`, `{ q: string }\n\n`, `/users/:id',\n})\n\n`, `path: '/users',\n})\n\n`)

const setup: SlideScript = {
  id: 'setup',
  initial: [['api.ts', '']],
  active: 'api.ts',
  cps: 1.6,
  hold: 45,
  actions: [
    { do: 'pause', frames: 20 },
    { do: 'cue', id: 'import' }, { do: 'type', file: 'api.ts', text: s1Import }, { do: 'pause', frames: 40 },
    { do: 'cue', id: 'output' }, { do: 'type', file: 'api.ts', text: s1Output }, { do: 'pause', frames: 40 },
    { do: 'cue', id: 'input' }, { do: 'type', file: 'api.ts', text: s1Input }, { do: 'pause', frames: 35 },
    { do: 'cue', id: 'define' }, { do: 'type', file: 'api.ts', text: s1Get }, { do: 'pause', frames: 45 },
    { do: 'cue', id: 'define2' }, { do: 'type', file: 'api.ts', text: s1Search }, { do: 'pause', frames: 35 },
    { do: 'cue', id: 'client' }, { do: 'type', file: 'api.ts', text: s1Client.replace(/\n$/, '') }, { do: 'pause', frames: 20 },
    { do: 'cue', id: 'typed' }, { do: 'hover', text: API_HOVER, frames: 110 },
    { do: 'cue', id: 'copy' },
  ],
}

// Slide 2: the call ----------------------------------------------------------
const ENDPOINTS: CompletionItem[] = [
  { label: 'getUser', detail: '(params: { id: string | number }, options?: CallOptions) => Promise<Result<User>>', kind: 'method' },
  { label: 'searchUsers', detail: '(params: SearchParams, options?: CallOptions) => Promise<Result<User[]>>', kind: 'method' },
]
const ERROR_FIELDS: CompletionItem[] = [
  { label: 'body', detail: 'unknown', kind: 'property' },
  { label: 'headers', detail: 'Headers', kind: 'property' },
  { label: 'kind', detail: 'ApiErrorKind', kind: 'property' },
  { label: 'request', detail: '{ method: string; url: string; params: unknown }', kind: 'property' },
  { label: 'status', detail: 'number', kind: 'property' },
  { label: 'statusText', detail: 'string', kind: 'property' },
]
const USER_FIELDS: CompletionItem[] = [
  { label: 'email', detail: 'string', kind: 'property' },
  { label: 'id', detail: 'string', kind: 'property' },
  { label: 'name', detail: 'string', kind: 'property' },
]

const call: SlideScript = {
  id: 'call',
  initial: [['api.ts', API_TS], ['profile.ts', '']],
  active: 'profile.ts',
  cps: 1.5,
  hold: 45,
  actions: [
    { do: 'pause', frames: 20 },
    { do: 'cue', id: 'call' },
    { do: 'type', file: 'profile.ts', text: `import { api } from './api'\n\nconst { data, error } = await api.` },
    { do: 'popup', items: ENDPOINTS, select: 0, frames: 50 },
    { do: 'type', file: 'profile.ts', text: `getUser({ ` },
    { do: 'cue', id: 'params' }, { do: 'hover', text: 'params: { id: string | number }', frames: 70 },
    { do: 'type', file: 'profile.ts', text: `id: '42' })\n\n` }, { do: 'pause', frames: 15 },
    { do: 'cue', id: 'result' },
    { do: 'type', file: 'profile.ts', text: `if (error) {\n  console.log(error.` },
    { do: 'popup', items: ERROR_FIELDS, select: 2, frames: 55 },
    { do: 'type', file: 'profile.ts', text: `kind` },
    { do: 'cue', id: 'kind' },
    { do: 'hover', text: `(property) kind: 'http' | 'network' | 'timeout'\n  | 'abort' | 'parse' | 'middleware'`, frames: 90 },
    { do: 'type', file: 'profile.ts', text: `)\n} else {\n  console.log(data.` },
    { do: 'cue', id: 'data' },
    { do: 'popup', items: USER_FIELDS, select: 2, frames: 60 },
    { do: 'type', file: 'profile.ts', text: `name)\n}` },
    { do: 'pause', frames: 20 },
    { do: 'cue', id: 'copy' },
  ],
}

// Slide 3: dedupe ------------------------------------------------------------
const search: SlideScript = {
  id: 'dedupe',
  initial: [['api.ts', API_TS], ['profile.ts', PROFILE_TS]],
  active: 'api.ts',
  cps: 2.2,
  hold: 45,
  actions: [
    { do: 'pause', frames: 15 },
    { do: 'cue', id: 'search' }, { do: 'flash', file: 'api.ts', match: 'const searchUsers', frames: 70 },
    { do: 'cue', id: 'ui' }, { do: 'tab', file: 'Search.tsx', frames: 12 },
    { do: 'type', file: 'Search.tsx', text: SEARCH_TSX.replace(/\n$/, '') }, { do: 'pause', frames: 20 },
    { do: 'cue', id: 'race' }, { do: 'preview', frames: 150 },
    { do: 'cue', id: 'fix' }, { do: 'tab', file: 'api.ts', frames: 12 },
    { do: 'type', file: 'api.ts', text: DEDUPE_LINE, after: `path: '/users',`, cps: 1 },
    { do: 'flash', file: 'api.ts', match: 'dedupe: true', frames: 40 },
    { do: 'cue', id: 'cancel' }, { do: 'tab', file: 'Search.tsx', frames: 8 }, { do: 'preview', frames: 150 },
    { do: 'cue', id: 'copy' },
  ],
}


// ============================================================================
// Slides 4–9. Each starts from api.ts as the slide before left it and adds to it.
// ============================================================================

const API_S3 = API_TS.replace(`path: '/users',`, `path: '/users',${DEDUPE_LINE}`)

// Slide 4: share ---------------------------------------------------------------
const GET_ME = `// GET /me: the signed-in user
const getMe = defineRequest<User>()({
  method: 'GET',
  path: '/me',
  share: true, // calls at the same moment share one request
})

`
const API_S4 = API_S3.replace(`  dedupe: true,\n})\n\n`, `  dedupe: true,\n})\n\n${GET_ME}`).replace('requests: { getUser, searchUsers }', 'requests: { getUser, searchUsers, getMe }')

const COMPONENTS_TSX = `import { useEffect, useState } from 'react'
import { api, type User } from './api'

// Three components, each asking for the signed-in user.
function useMe() {
  const [me, setMe] = useState<User>()
  useEffect(() => {
    api.getMe().then(({ data }) => { if (data) setMe(data) })
  }, [])
  return me
}

export const Header = () => <header>{useMe()?.name}</header>
export const Sidebar = () => <aside>{useMe()?.email}</aside>
export const Avatar = () => <img alt={useMe()?.name} />
`

const share: SlideScript = {
  id: 'share',
  initial: [['api.ts', API_S3], ['Search.tsx', SEARCH_TSX]],
  active: 'api.ts',
  cps: 2.2,
  hold: 45,
  actions: [
    { do: 'pause', frames: 15 },
    { do: 'cue', id: 'need' }, { do: 'pause', frames: 45 },
    { do: 'cue', id: 'share' }, { do: 'type', file: 'api.ts', text: GET_ME, after: `  dedupe: true,\n})\n\n` },
    { do: 'type', file: 'api.ts', text: ', getMe', after: 'requests: { getUser, searchUsers', cps: 1 }, { do: 'pause', frames: 25 },
    { do: 'cue', id: 'use' }, { do: 'tab', file: 'components.tsx', frames: 12 },
    { do: 'type', file: 'components.tsx', text: COMPONENTS_TSX.replace(/\n$/, '') }, { do: 'pause', frames: 20 },
    { do: 'cue', id: 'one' }, { do: 'preview', frames: 150 },
    { do: 'cue', id: 'copy' },
  ],
}

// Slide 5: middleware ----------------------------------------------------------
const MW_IMPORT = `\nimport { logMiddleware, retryMiddleware } from 'liaise/middleware'`
const MW_LINE = `\n  middleware: [retryMiddleware(3), logMiddleware],`
const AUTH_TS = `import type { Middleware } from 'liaise'
import { getToken, signOut } from './session'

// Runs around every call: before fetch, after the Result.
export const auth: Middleware = async (ctx, next) => {
  ctx.request.headers.set('authorization', \`Bearer \${getToken()}\`)
  const result = await next()
  if (result.error?.status === 401) signOut()
  return result
}
`
const AUTH_IMPORT = `\nimport { auth } from './auth'`
const AUTH_LINE = `\n  middleware: [auth],`
const API_S5 = API_S4.replace(`from 'liaise'`, `from 'liaise'${AUTH_IMPORT}`).replace(`baseUrl: 'https://api.example.com',`, `baseUrl: 'https://api.example.com',${AUTH_LINE}`)

const middleware: SlideScript = {
  id: 'middleware',
  initial: [['api.ts', API_S4], ['components.tsx', COMPONENTS_TSX]],
  active: 'api.ts',
  cps: 2,
  hold: 45,
  actions: [
    { do: 'pause', frames: 15 },
    { do: 'cue', id: 'builtin' },
    { do: 'type', file: 'api.ts', text: MW_IMPORT, after: `from 'liaise'` },
    { do: 'type', file: 'api.ts', text: MW_LINE, after: `baseUrl: 'https://api.example.com',` },
    { do: 'cue', id: 'log' }, { do: 'preview', frames: 120 },
    { do: 'cue', id: 'own' },
    { do: 'erase', file: 'api.ts', text: MW_LINE }, { do: 'erase', file: 'api.ts', text: MW_IMPORT }, { do: 'pause', frames: 15 },
    { do: 'tab', file: 'auth.ts', frames: 12 },
    { do: 'cue', id: 'wrap' }, { do: 'type', file: 'auth.ts', text: AUTH_TS.replace(/\n$/, '') }, { do: 'pause', frames: 20 },
    { do: 'cue', id: 'plug' }, { do: 'tab', file: 'api.ts', frames: 10 },
    { do: 'type', file: 'api.ts', text: AUTH_IMPORT, after: `from 'liaise'` },
    { do: 'type', file: 'api.ts', text: AUTH_LINE, after: `baseUrl: 'https://api.example.com',` },
    { do: 'cue', id: 'see' }, { do: 'preview', frames: 150 },
    { do: 'cue', id: 'copy' },
  ],
}

// Slide 6: pagination ----------------------------------------------------------
const LIST_POSTS = `export type Post = { id: string; title: string }
type PostsPage = { posts: Post[]; next?: string }
type PostsParams = { limit: number; cursor?: string }

// GET /posts: one page of posts, and the cursor of the next one
const listPosts = defineRequest<PostsPage, PostsParams>()({
  method: 'GET',
  path: '/posts',
})

`
const API_S6 = API_S5.replace(GET_ME, GET_ME + LIST_POSTS).replace('searchUsers, getMe }', 'searchUsers, getMe, listPosts }')

const BLOG_TSX = `import { useState } from 'react'
import { paginate } from 'liaise'
import { api, type Post } from './api'

// Nothing is fetched yet. Each pages.next() gets one page.
const pages = paginate(api.listPosts, { limit: 10 }, {
  next: (p, prev) =>
    p.data.next ? { ...prev, cursor: p.data.next } : undefined,
})

export function Blog() {
  const [posts, setPosts] = useState<Post[]>([])
  const [more, setMore] = useState(true)

  async function loadMore() {
    // One request per click
    const { value: page, done } = await pages.next()
    if (done) return setMore(false)
    if (page.error) return // an error page ends the walk
    const fresh = page.data.posts
    setPosts(all => [...all, ...fresh])
  }

  return (
    <>
      {posts.map(p => <article key={p.id}>{p.title}</article>)}
      {more && <button onClick={loadMore}>Load more</button>}
    </>
  )
}
`

const pagination: SlideScript = {
  id: 'pagination',
  initial: [['api.ts', API_S5], ['auth.ts', AUTH_TS]],
  active: 'api.ts',
  cps: 2.4,
  hold: 45,
  actions: [
    { do: 'pause', frames: 15 },
    { do: 'cue', id: 'list' }, { do: 'type', file: 'api.ts', text: LIST_POSTS, after: GET_ME },
    { do: 'type', file: 'api.ts', text: ', listPosts', after: 'searchUsers, getMe', cps: 1 }, { do: 'pause', frames: 20 },
    { do: 'cue', id: 'walk' }, { do: 'tab', file: 'Blog.tsx', frames: 12 },
    { do: 'type', file: 'Blog.tsx', text: BLOG_TSX.replace(/\n$/, '') }, { do: 'pause', frames: 20 },
    { do: 'cue', id: 'click' }, { do: 'preview', frames: 200 },
    { do: 'cue', id: 'copy' },
  ],
}

// Slide 7: polling -------------------------------------------------------------
const GET_UNREAD = `// GET /notifications/unread: how many are unread
const getUnread = defineRequest<{ unread: number }>()({
  method: 'GET',
  path: '/notifications/unread',
})

`
const API_S7 = API_S6.replace(LIST_POSTS, LIST_POSTS + GET_UNREAD).replace('getMe, listPosts }', 'getMe, listPosts, getUnread }')

const BELL_TSX = `import { useEffect, useState } from 'react'
import { poll } from 'liaise'
import { api } from './api'

export function Bell() {
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    // Ask every 10 s. Every bell on the page shares one poll.
    const stop = poll(api.getUnread, {}, ({ data, error }) => {
      if (!error) setUnread(data.unread)
    }, { every: 10_000 })
    return stop // the last bell to unmount stops it
  }, [])

  return (
    <button aria-label={\`\${unread} unread\`}>
      {unread > 0 && <span>{unread}</span>}
    </button>
  )
}
`

const polling: SlideScript = {
  id: 'polling',
  initial: [['api.ts', API_S6], ['Blog.tsx', BLOG_TSX]],
  active: 'api.ts',
  cps: 2.3,
  hold: 45,
  actions: [
    { do: 'pause', frames: 15 },
    { do: 'cue', id: 'count' }, { do: 'type', file: 'api.ts', text: GET_UNREAD, after: LIST_POSTS },
    { do: 'type', file: 'api.ts', text: ', getUnread', after: 'getMe, listPosts', cps: 1 }, { do: 'pause', frames: 20 },
    { do: 'cue', id: 'poll' }, { do: 'tab', file: 'Bell.tsx', frames: 12 },
    { do: 'type', file: 'Bell.tsx', text: BELL_TSX.replace(/\n$/, '') }, { do: 'pause', frames: 20 },
    { do: 'cue', id: 'ring' }, { do: 'preview', frames: 210 },
    { do: 'cue', id: 'copy' },
  ],
}

// Slide 8: cache ---------------------------------------------------------------
const WEATHER_TS = `import { createApi, defineRequest } from 'liaise'
import { cacheMiddleware } from 'liaise/middleware'

type Weather = { city: string; tempC: number; sky: string }

// Weather won't change in 20 minutes: keep each answer that long.
const keep20min = cacheMiddleware({ ttl: 20 * 60_000 })

const getWeather = defineRequest<Weather, { city: string }>()({
  method: 'GET',
  path: '/weather',
  middleware: [keep20min],
})

export const weather = createApi({
  baseUrl: 'https://weather.example.com',
  requests: { getWeather },
})

// Two widgets ask for Tallinn. The second stays in the browser.
const today = await weather.getWeather({ city: 'Tallinn' })
const sidebar = await weather.getWeather({ city: 'Tallinn' })
`

const cache: SlideScript = {
  id: 'cache',
  initial: [['api.ts', API_S7], ['Bell.tsx', BELL_TSX]],
  active: 'api.ts',
  cps: 2.3,
  hold: 45,
  actions: [
    { do: 'pause', frames: 15 },
    { do: 'cue', id: 'weather' }, { do: 'tab', file: 'weather.ts', frames: 12 },
    { do: 'type', file: 'weather.ts', text: WEATHER_TS.split('const getWeather')[0] },
    { do: 'cue', id: 'endpoint' }, { do: 'type', file: 'weather.ts', text: 'const getWeather' + WEATHER_TS.split('const getWeather')[1].split('// Two widgets')[0] },
    { do: 'cue', id: 'twice' }, { do: 'type', file: 'weather.ts', text: '// Two widgets' + WEATHER_TS.split('// Two widgets')[1].replace(/\n$/, '') }, { do: 'pause', frames: 15 },
    { do: 'cue', id: 'hit' }, { do: 'preview', frames: 210 },
    { do: 'cue', id: 'copy' },
  ],
}

// Slide 9: search with dedupe and cache -------------------------------------------
const CACHE_IMPORT = `\nimport { cacheMiddleware } from 'liaise/middleware'`
const SEARCH_CACHE = `// Each search is kept for a minute
const searchCache = cacheMiddleware({ ttl: 60_000 })

`
const SEARCH_MW = `\n  middleware: [searchCache],`
const API_S9 = API_S7
  .replace(`from './auth'`, `from './auth'${CACHE_IMPORT}`)
  .replace(`// GET /users?q=ada`, `${SEARCH_CACHE}// GET /users?q=ada`)
  .replace(`  dedupe: true,`, `  dedupe: true,${SEARCH_MW}`)
const RECENT = `
      <nav>
        {['ada', 'grace', 'alan'].map(name => (
          <button key={name} onClick={() => search(name)}>
            {name}
          </button>
        ))}
      </nav>`
const SEARCH_FINAL = SEARCH_TSX.replace(`onChange={e => search(e.target.value)}\n      />`, `onChange={e => search(e.target.value)}\n      />${RECENT}`)

const together: SlideScript = {
  id: 'together',
  initial: [['api.ts', API_S7], ['Search.tsx', SEARCH_TSX], ['weather.ts', WEATHER_TS]],
  active: 'api.ts',
  cps: 2,
  hold: 45,
  actions: [
    { do: 'pause', frames: 15 },
    { do: 'cue', id: 'back' }, { do: 'flash', file: 'api.ts', match: 'dedupe: true', frames: 60 },
    { do: 'cue', id: 'keep' },
    { do: 'type', file: 'api.ts', text: CACHE_IMPORT, after: `from './auth'` },
    { do: 'type', file: 'api.ts', text: SEARCH_CACHE, after: `path: '/users/:id',\n})\n\n` },
    { do: 'type', file: 'api.ts', text: SEARCH_MW, after: `  dedupe: true,`, cps: 1 }, { do: 'pause', frames: 20 },
    { do: 'cue', id: 'chips' }, { do: 'tab', file: 'Search.tsx', frames: 12 },
    { do: 'type', file: 'Search.tsx', text: RECENT, after: `onChange={e => search(e.target.value)}\n      />` }, { do: 'pause', frames: 20 },
    { do: 'cue', id: 'typing' }, { do: 'preview', frames: 130 },
    { do: 'cue', id: 'instant' }, { do: 'preview', frames: 150 },
    { do: 'cue', id: 'copy' },
  ],
}

export const SLIDES = [setup, call, search, share, middleware, pagination, polling, cache, together].map(compile)

export type Caption = { title: string; body: string }

/** Captions by slide id, then cue id. Short, plain, one idea each. */
export const CAPTIONS: Record<string, Record<string, Caption>> = {
  setup: {
    import: { title: 'Start with fetch. Add types.', body: 'liaise is a typed layer over fetch, with no dependencies.' },
    output: { title: 'Say what comes back.', body: 'A User is what the server returns.' },
    input: { title: 'And what goes in.', body: 'A search sends a q.' },
    define: { title: 'Define each endpoint once.', body: 'The path says it needs an id. TypeScript will ask for one.' },
    define2: { title: 'Then the next one.', body: 'Search returns a list of Users.' },
    client: { title: 'One client for all of them.', body: 'createApi turns your definitions into typed functions.' },
    typed: { title: 'Every call is already typed.', body: 'Hover the client: each endpoint is a function with its own params and result.' },
    copy: { title: "That's the whole setup.", body: 'Copy it and point baseUrl at your API.' },
  },
  call: {
    call: { title: 'Call it like a function.', body: 'Your editor lists the endpoints you defined.' },
    params: { title: 'The path param is part of the type.', body: "Leave out id and it won't compile." },
    result: { title: 'Every call returns data or error.', body: 'Nothing throws. Not a 500, not a timeout, not going offline.' },
    kind: { title: 'error.kind says what went wrong.', body: 'Six kinds. Handle each one, or just show a message.' },
    data: { title: 'Past the check, data is a User.', body: 'Your editor knows every field.' },
    copy: { title: "That's a complete call.", body: 'Copy it into your own code.' },
  },
  dedupe: {
    search: { title: 'Remember searchUsers?', body: 'It is about to power a search box.' },
    ui: { title: 'Wire it to an input.', body: 'Every keystroke sends a request.' },
    race: { title: 'Fast typing has a catch.', body: "Short queries answer slowly. The answer for 'a' lands after 'ada' and overwrites it." },
    fix: { title: 'One line fixes it.', body: 'dedupe: true cancels the call that is still running.' },
    cancel: { title: 'Only the latest answer lands.', body: "The calls for 'a' and 'ad' end as 'abort', and your code ignores them." },
    copy: { title: 'A search without stale results.', body: 'Copy the component.' },
  },
  share: {
    need: { title: 'Three components, one user.', body: 'A header, a sidebar and an avatar each ask for the signed-in user.' },
    share: { title: 'share: true.', body: 'Calls made at the same moment share one request.' },
    use: { title: 'Each component asks on its own.', body: 'No store, no context, no prop drilling.' },
    one: { title: 'One request. Three answers.', body: 'Each caller still gets its own Result. A call with a different user never joins.' },
    copy: { title: 'Share the request, not the state.', body: 'Copy the components.' },
  },
  middleware: {
    builtin: { title: 'Middleware wraps every call.', body: 'Two come built in: retry and log.' },
    log: { title: 'Retries and a log, one line each.', body: 'retryMiddleware retries 5xx answers. logMiddleware prints every call.' },
    own: { title: 'Or write your own.', body: 'A middleware is a function around the call.' },
    wrap: { title: 'Before fetch, and after the Result.', body: 'Add a header on the way out. React to a 401 on the way back.' },
    plug: { title: 'Plug it into the client.', body: 'Every call through api now carries the token.' },
    see: { title: 'Every request, signed.', body: 'And a 401 signs the user out, wherever it happened.' },
    copy: { title: 'One place for cross-cutting code.', body: 'Copy the middleware.' },
  },
  pagination: {
    list: { title: 'A list that comes in pages.', body: 'Each page carries the cursor of the next one.' },
    walk: { title: 'paginate walks it for you.', body: 'It asks for a page only when you call next().' },
    click: { title: 'One click, one request.', body: 'The cursor goes along by itself. The last page ends the walk.' },
    copy: { title: 'Load more, without the bookkeeping.', body: 'Copy the blog.' },
  },
  polling: {
    count: { title: 'A count that changes on its own.', body: 'Unread notifications live on the server.' },
    poll: { title: 'poll asks on an interval.', body: 'Return stop from the effect and it ends when the bell unmounts.' },
    ring: { title: 'Every 10 seconds, one request.', body: 'Two bells on the page share one poll. A hidden tab pauses it.' },
    copy: { title: 'A live badge in one effect.', body: 'Copy the bell.' },
  },
  cache: {
    weather: { title: 'Some answers stay true for a while.', body: "The weather in 20 minutes is today's weather." },
    endpoint: { title: 'Cache it on the endpoint.', body: 'cacheMiddleware keeps each answer for 20 minutes.' },
    twice: { title: 'Ask twice.', body: 'Two widgets want the same city.' },
    hit: { title: 'One request.', body: 'The second answer comes from the cache. After 20 minutes the next call asks again.' },
    copy: { title: 'Fewer requests, same code.', body: 'Copy the client.' },
  },
  together: {
    back: { title: 'Back to the search.', body: 'dedupe already handles fast typing.' },
    keep: { title: 'Add a cache to the same endpoint.', body: 'Each search is kept for a minute.' },
    chips: { title: 'Recent searches.', body: 'One click runs a search you already did.' },
    typing: { title: 'Typing: only the latest call lands.', body: 'The calls for each half-typed word are cancelled.' },
    instant: { title: 'Going back: no request at all.', body: 'A recent search comes straight from the cache.' },
    copy: { title: 'dedupe and a cache, on one endpoint.', body: 'Copy the search.' },
  },
}

/** What the Copy button copies on each slide. */
export const COPY_TEXT: Record<string, string> = {
  setup: API_TS,
  call: PROFILE_TS,
  dedupe: SEARCH_TSX,
  share: COMPONENTS_TSX,
  middleware: AUTH_TS,
  pagination: BLOG_TSX,
  polling: BELL_TSX,
  cache: WEATHER_TS,
  together: SEARCH_FINAL,
}

export const SOURCES = { API_TS, PROFILE_TS, SEARCH_TSX, API_TS_DEDUPE: API_S3, API_FINAL: API_S9, COMPONENTS_TSX, AUTH_TS, BLOG_TSX, BELL_TSX, WEATHER_TS, SEARCH_FINAL }
