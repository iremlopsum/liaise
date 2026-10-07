// =============================================================================
// path-params.ts — Path parameter substitution and query string building
// =============================================================================
//
// This utility handles the URL construction pipeline:
//
// 1. Start with a base URL and a path template (e.g., '/api' + '/items/:id')
// 2. Find the `:param` tokens in the path -- a `:name` that starts a path
//    segment -- and look each one up in the params object
// 3. Replace matched tokens with URI-encoded values
// 4. Separate consumed (path) params from remaining params
// 5. Optionally serialize remaining params as a query string
//
// The separation between "path params" and "remaining params" is important
// because it determines what goes in the URL vs. what goes in the request body
// (for POST/PUT/PATCH) or query string (for GET/DELETE).
// =============================================================================

/**
 * Result of building a URL from a base, path template, and params.
 *
 * @property url - The fully constructed URL (base + resolved path + optional query string)
 * @property remaining - Params that were NOT consumed by path param substitution.
 *   When `asQuery` is true, this is always empty (all remaining params went into
 *   the query string). When `asQuery` is false, these params are available for
 *   the caller to serialize as a request body.
 */
interface BuildUrlResult {
  url: string
  remaining: Record<string, unknown>
}

/**
 * Joins a base URL and a path with exactly one separating slash.
 *
 * A trailing slash on baseUrl is the shape `process.env.API_URL` usually has.
 * Naive concatenation produces '//', which some servers 404 on and which can
 * trigger a cross-origin redirect that drops the Authorization header. An
 * empty baseUrl (same-origin usage) passes the path through untouched.
 *
 * Exported so the error paths that report a URL without having built one —
 * a synchronous failure before buildUrl returns — can describe the same URL
 * the request would have used, rather than a naively concatenated one.
 *
 * @param baseUrl - The API base URL, with or without a trailing slash.
 * @param path - The path to append, with or without a leading slash.
 * @returns The joined URL.
 */
export function joinUrl(baseUrl: string, path: string): string {
  if (!baseUrl) return path

  // Fragment first, then query. RFC 3986 orders a URL path?query#fragment, so
  // everything after the first '#' is fragment -- INCLUDING a '?'. Splitting
  // the query first would read '#f?x=1' as a query string 'x=1' that is not
  // one, and then re-emit it as a real query. These two splits are not
  // interchangeable, and this is the order that makes them correct.
  const [baseRest, baseFragment] = splitFragment(baseUrl)
  const [pathRest, pathFragment] = splitFragment(path)

  // Both sides may carry a query string — a baseUrl with a fixed API key, a
  // path template with a fixed filter — and a query must sit after the whole
  // path, not in the middle of it. Concatenating instead (as this did before
  // 4.2.1) put the path inside the base's query VALUE:
  // 'https://api.test/v1?key=abc' + '/items' became '.../v1?key=abc/items',
  // which resolves to path '/v1'. The request went to a different endpoint,
  // and nothing said so.
  const [basePath, baseQuery] = splitQuery(baseRest)
  const [pathOnly, pathQuery] = splitQuery(pathRest)

  const base = basePath.replace(/\/+$/, '')
  const tail = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`

  // Base params first, then the path template's; buildUrl's Phase 3 appends the
  // call's after both, so the wire order reads base -> template -> call.
  //
  // This ACCUMULATES rather than overriding, which is the one way it differs
  // from `mergeHeaders` — that uses `set()`, so a per-call header replaces a
  // global one. Here a call param with a key the base already used produces
  // BOTH: `?key=abc&key=xyz`, and which one a server honours is its own
  // business (`searchParams.get` takes the first; PHP takes the last).
  //
  // Accumulating is deliberate: array params already serialize as repeated
  // keys, so `tags=a&tags=b` is a shape this function must preserve, and
  // de-duplicating by key would silently collapse it. The consequence is that
  // a base-level param cannot be overridden per call — put it in middleware
  // instead if it needs to vary.
  const query = [baseQuery, pathQuery].filter(Boolean).join('&')

  // A fragment belongs after the whole URL, for the same reason a query does.
  // buildUrl REFUSES a fragment, so this only runs on the error path, where
  // `urlForError` falls back to joinUrl after buildUrl has thrown. That report
  // still has to name an address: before 4.4.0 it left the base's fragment
  // mid-string -- 'https://api.test/v1#f' + '/items' gave '.../v1#f/items',
  // which parses to pathname '/v1'. Diagnostic output that resolves to the
  // wrong endpoint is the same defect 4.2.1 removed from the request path.
  //
  // Two fragments join with '#' rather than picking one, which is what a URL
  // parser already does with the remainder: it keeps both strings visible in a
  // report whose only job is to show what was written.
  const fragment = [baseFragment, pathFragment].filter(Boolean).join('#')

  return `${base}${tail}${query ? `?${query}` : ''}${fragment ? `#${fragment}` : ''}`
}

/**
 * Splits a URL piece into its path part and its query part, without the `?`.
 *
 * Returns `['', '']`-shaped pairs rather than using `URL`, because both
 * arguments here are routinely relative (`baseUrl` may be `/api`, a `path`
 * always is) and `new URL` requires an absolute base it does not have.
 *
 * Run this AFTER `splitFragment` — a '?' after a '#' is part of the fragment,
 * not a query string.
 */
function splitQuery(value: string): [path: string, query: string] {
  const at = value.indexOf('?')
  return at === -1 ? [value, ''] : [value.slice(0, at), value.slice(at + 1)]
}

/**
 * Splits a URL piece at the first `#`, returning the part before it and the
 * fragment without its leading `#`.
 *
 * Same reason as `splitQuery` for not using `URL`: both arguments are routinely
 * relative. The first `#` wins because everything after it is fragment, so a
 * second one needs no special handling here.
 */
function splitFragment(value: string): [rest: string, fragment: string] {
  const at = value.indexOf('#')
  return at === -1 ? [value, ''] : [value.slice(0, at), value.slice(at + 1)]
}

/**
 * The `TypeError` `buildUrl` throws for a mistake in the template itself — a
 * URL fragment, or a `:name` in the path's query string — carrying the URL the
 * request would have used.
 *
 * A thrown error cannot return a value, and these two refusals are the
 * failures where a useful URL still exists: substitution would have worked
 * perfectly: only the fragment, or the query string, is wrong. Without this,
 * `urlForError` had nothing to report but the raw template, so
 * `error.request.url` came back as `/users/:id#f` — the same
 * `:id`-in-telemetry defect 4.0.2 removed from the middleware path (BACKLOG
 * §2.7, fixed 4.4.1). It was `FragmentError` until 5.2.1 added the query-string
 * refusal, which has the same shape and the same reason to carry a URL.
 *
 * The per-call refusals (an unusable value, an unfilled token, a mid-segment
 * `:name` a param names) throw a plain `TypeError`, and `urlForError` reports
 * the template for them: this call's params did not make a URL, so there is
 * none to name.
 *
 * It extends `TypeError` rather than replacing it so nothing else has to
 * change: `name` stays `'TypeError'`, `String(err)` is byte-identical, and
 * `execute()`'s setup catch still classifies it as a `'network'` Result.
 * Deliberately NOT exported from `src/index.ts` — consumers read
 * `error.request.url`, not this.
 */
export class TemplateError extends TypeError {
  constructor(message: string, readonly resolvedUrl: string) {
    super(message)
  }
}

/**
 * Why `value` cannot fill a path segment, or `null` when it can.
 *
 * A segment is filled with `String(value)`, which never fails — it just turns
 * a mistake into a plausible-looking URL ('/users/undefined', '/users/null',
 * '/users/', '/users/[object Object]'). Those requests reach a real server and
 * come back as a 404 or, worse, as someone else's data. Accepted: non-empty
 * strings, finite numbers, bigints and booleans. A Date gets its own hint,
 * matching the query-string rule: ISO and epoch are both common, so the
 * caller picks.
 */
function unusableSegment(value: unknown): string | null {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (value === '') return 'an empty string'
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value)
  if (value instanceof Date) return 'a Date (convert it first, e.g. date.toISOString() or date.getTime())'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'object') return 'an object'
  if (typeof value === 'function' || typeof value === 'symbol') return `a ${typeof value}`
  return null
}

/**
 * Substitutes `:param` tokens in the path with matching values from params,
 * optionally appends remaining params as a query string.
 *
 * This is the main URL construction function used by the request engine.
 * It handles the full lifecycle from path template to final URL.
 *
 * **Path param matching** scans the template once for `:name` tokens
 * (`[a-zA-Z0-9_]+`, greedy), so a param key `id` fills `:id` but never part of
 * `:idExtra`. A `:name` is a token only where it STARTS a path segment — at
 * the start of the path or right after a `/` — which is the same rule the
 * `PathParams` type and the unresolved-token check use. A colon anywhere else
 * is text: `/v1/documents:batchGet` and `/time/12:30` are sent as written.
 * A token is filled only from a non-empty string, a finite number,
 * a bigint or a boolean; `undefined`, `null`, `''`, objects, arrays and Dates
 * throw a TypeError naming the param, so a call is never sent to
 * '/users/undefined'.
 *
 * **Refused templates.** Every refusal is a TypeError, which `execute()` turns
 * into a `'network'` Result, so nothing is sent. Two are mistakes in the
 * template, wrong for every call: a URL fragment, and a `:name` in the path's
 * query string (`?:name`, `&:name`, `=:name`). Three depend on this call's
 * params: a mid-segment `:name` that a param names (`/items/v:version` with
 * `{ version }`), a value that cannot make a segment, and a token no param
 * fills. The template mistakes are reported first.
 *
 * **Query string rules** (when `asQuery` is true):
 * - Primitives: `{ page: 1 }` → `?page=1`
 * - Arrays: repeated keys — `{ tags: ['a', 'b'] }` → `?tags=a&tags=b`
 * - null/undefined: silently omitted
 * - Nested objects: throws TypeError (must flatten before passing)
 *
 * @param baseUrl - API base URL (e.g., '/api' or 'https://api.example.com')
 * @param path - Path template with optional `:param` tokens (e.g., '/items/:id')
 * @param params - Key-value params to substitute and/or serialize
 * @param asQuery - If true, remaining (non-path) params are appended as query string.
 *   Defaults to false.
 * @returns The built URL and any remaining params not consumed by path or query
 *
 * @example
 * ```ts
 * // Path param substitution
 * buildUrl('/api', '/items/:id', { id: '42', page: 1 })
 * // → { url: '/api/items/42', remaining: { page: 1 } }
 *
 * // With query string
 * buildUrl('/api', '/items', { page: 1, limit: 20 }, true)
 * // → { url: '/api/items?page=1&limit=20', remaining: {} }
 * ```
 */
export function buildUrl(baseUrl: string, path: string, params: Record<string, unknown>, asQuery = false): BuildUrlResult {
  // -------------------------------------------------------------------------
  // Phase 0: Reject a fragment
  // -------------------------------------------------------------------------
  // A fragment is a client-side anchor — `fetch` never transmits it — so one
  // in a request URL cannot do anything the caller intended. Worse, before
  // 4.2.1 it silently ate the query string: '/docs#section' with { page: 2 }
  // produced '/docs#section?page=2', which the network layer reads as path
  // '/docs' with NO search at all. The param vanished and nothing reported it.
  //
  // Refused rather than stripped, because stripping hides the mistake and the
  // caller keeps a line of code that does nothing. Throwing here reaches the
  // caller as a Result, via execute()'s setup catch — the "never throws"
  // contract is unaffected.
  // -------------------------------------------------------------------------
  //
  // DETECTED here, THROWN after Phase 1. Detecting here preserves precedence:
  // a fragment is wrong for every call, an unfilled `:token` only for this one,
  // so the fragment must still win when a config is broken both ways. Throwing
  // later is what lets the error name a substituted URL instead of the raw
  // template. Moving the throw past Phase 1b would silently flip that order —
  // there is a test for it.
  // -------------------------------------------------------------------------
  const fragmentIn = path.includes('#') ? { where: 'path', value: path } : baseUrl.includes('#') ? { where: 'baseUrl', value: baseUrl } : null

  let resolvedPath = path
  const remaining: Record<string, unknown> = {}
  const lookup = new Map(Object.entries(params))

  // -------------------------------------------------------------------------
  // Phase 0a: Find every `:name` that does NOT start a path segment
  // -------------------------------------------------------------------------
  // Phase 1 fills a `:name` only at the start of a segment, so every other one
  // is sent as text. That is right for a colon that is part of the resource
  // ('/v1/documents:batchGet', '/time/12:30'), and wrong in two cases, which
  // are found here and thrown later, each in its precedence slot:
  //
  // - A `:name` right after the '?', a '&' or a '=' in the template's query
  //   string ('/price?:qs', '/search?sort=:sort'). A path template has no way
  //   to fill a query string, and sending ':qs' as text is never what the
  //   template meant. Refused whether or not a param has the name: the
  //   template is wrong for every call (thrown in Phase 0c).
  // - Any other mid-segment `:name` that a param of this call NAMES
  //   ('/items/v:version' with { version: '2' }). Before 5.2.1 the fill was
  //   unanchored and substituted it, and an explicit `new Request` type could
  //   ask for exactly that. Anchoring alone would quietly move the value to the
  //   query string or the body instead; refusing makes the one behaviour the
  //   anchor changes loud (thrown in Phase 1b). With no param of that name the
  //   colon is literal text and nothing is said.
  //
  // The scan uses the token grammar Phase 1 uses, unanchored, and reads the
  // character before each match through its index. A lookbehind would say the
  // same thing in the regex, and is banned for the reason Phase 1b gives. An
  // index of 0 (`path[-1]` is undefined) counts as a segment start, as `^`
  // does in Phase 1's pattern. The query string starts after the template's
  // first '?', so a '&' or '=' before it ('/a/x=:b') is mid-segment text like
  // any other. A `:name` right after a '/' is a token wherever it sits, even
  // in the query string ('?next=/:id'): the type and Phase 1b read it that
  // way too, so it is filled, not refused.
  // -------------------------------------------------------------------------
  const queryAt = path.indexOf('?')
  const inQuery: string[] = []
  const midSegment: string[] = []
  const anyToken = /:([a-zA-Z0-9_]+)/g
  for (let match = anyToken.exec(path); match; match = anyToken.exec(path)) {
    const at = match.index
    const before = path[at - 1] ?? '/'
    const name = match[1]
    const found = before === '/' ? null
      : queryAt >= 0 && at > queryAt && '?&='.includes(before) ? inQuery
      : lookup.has(name) ? midSegment : null
    // Record once per name: a repeated `:name` is one mistake.
    if (found && !found.includes(name)) found.push(name)
  }

  // -------------------------------------------------------------------------
  // Phase 1: Path parameter substitution
  // -------------------------------------------------------------------------
  // Scan the template once for `:name` tokens that START a path segment, and
  // look each up in params. Before 5.0.1 this built a RegExp from every param
  // KEY, unescaped, so a key like 'a.b' (where '.' matches any character) could
  // substitute the token ':aXb'. The token grammar is the one
  // define-request.ts's type-level parser uses: [a-zA-Z0-9_]+, matched
  // greedily, so ':id' never matches inside ':idExtra'. A repeated token
  // ('/orgs/:id/members/:id') is substituted at every occurrence.
  // encodeURIComponent escapes ':' to '%3A', so a value can never produce a
  // token of its own.
  //
  // Anchored since 5.2.1: `(^|\/)` before the colon, re-emitted as `start` in
  // front of the value, so the anchor is a capture and not a lookbehind. Until
  // then this scan matched a `:name` anywhere, while the `PathParams` type and
  // Phase 1b's unresolved-token check only counted one at the start of a
  // segment, and the three disagreed: '/v1/documents:batchGet' with
  // { batchGet: 'yes' } built '/v1/documentsyes', a URL the type said could
  // not exist, and '/price?:qs' typed as {} but encoded any `qs` it was given
  // into a broken query string. Now one rule serves all three. The anchor
  // consumes only the '/' in front of its own colon, and a name never contains
  // a '/', so back-to-back tokens ('/:a/:b') each still find theirs.
  // -------------------------------------------------------------------------
  //
  // A token is filled only from a value that makes a real segment (see
  // `unusableSegment`). Before 5.0.2 String(value) went in unchecked, so
  // { id: undefined } built '/users/undefined' and the call was sent — the
  // component-rendered-before-the-id-loaded bug. A bad value is recorded here
  // and thrown after Phase 0b, so a fragment still wins when both are wrong.
  // -------------------------------------------------------------------------
  const consumed = new Set<string>()
  const unusable: string[] = []
  resolvedPath = resolvedPath.replace(/(^|\/):([a-zA-Z0-9_]+)/g, (token: string, start: string, name: string) => {
    if (!lookup.has(name)) return token
    consumed.add(name)
    const value = lookup.get(name)
    const problem = unusableSegment(value)
    if (problem) {
      // Record once per name: a repeated token ('/a/:id/b/:id') is one mistake.
      if (!unusable.some(entry => entry.startsWith(`"${name}"`))) unusable.push(`"${name}" is ${problem}`)
      return token
    }
    return start + encodeURIComponent(String(value))
  })
  for (const [key, value] of lookup) {
    if (!consumed.has(key)) remaining[key] = value
  }

  // -------------------------------------------------------------------------
  // Phase 0b: Throw the fragment refusal detected above
  // -------------------------------------------------------------------------
  // Now that substitution has run, the error can name the URL the call was
  // actually for. Any raw '#' still in `resolvedPath` provably came from the
  // template, never from a value: `encodeURIComponent` escapes a '#' in a value
  // to '%23', which is legitimate data and must not be refused.
  //
  // The MESSAGE keeps naming the original path or baseUrl. The two fields
  // answer different questions — the message says what to edit, the URL says
  // what was called — and collapsing them would name a string that appears
  // nowhere in the consumer's source.
  // -------------------------------------------------------------------------
  if (fragmentIn) {
    const fragment = fragmentIn.value.slice(fragmentIn.value.indexOf('#'))
    throw new TemplateError(
      `A URL fragment is never sent to the server, so it cannot appear in a ${fragmentIn.where}. ` +
      `Remove "${fragment}" from "${fragmentIn.value}".`,
      joinUrl(baseUrl, resolvedPath)
    )
  }

  // -------------------------------------------------------------------------
  // Phase 0c: Throw the query-string refusal found in Phase 0a
  // -------------------------------------------------------------------------
  // The second template mistake, so it goes right after the first: after the
  // fragment, which is the older refusal and also wrong for every call, and
  // before Phase 1b, whose refusals depend on this call's params. Thrown as a
  // `TemplateError` for the fragment's reason: substitution ran, so the report
  // names the URL the call was for, with the `:name` text where the template
  // put it ('/coins/btc/price?:qs', not '/coins/:id/price?:qs'). Moving this
  // below Phase 1b would flip the order; there is a test for it.
  //
  // The message points to where query params belong — the params type, which
  // `defineRequest` takes as its second type argument — and builds the example
  // from the names the template used.
  // -------------------------------------------------------------------------
  if (inQuery.length > 0) {
    throw new TemplateError(
      `A path template can't fill a query string: ${inQuery.map(name => `":${name}"`).join(', ')} in "${path}". ` +
      "Declare query params in defineRequest's second type argument, " +
      `e.g. defineRequest<TResponse, { ${inQuery.map(name => `${name}: string`).join('; ')} }>().`,
      joinUrl(baseUrl, resolvedPath)
    )
  }

  // -------------------------------------------------------------------------
  // Phase 1b: Reject the per-call mistakes
  // -------------------------------------------------------------------------
  // Three of them, in this order:
  //
  // 1. A mid-segment `:name` a param names (found in Phase 0a). First, because
  //    the fix is to the template, and moving the `:name` to the start of a
  //    segment can change which tokens there are, so the other two would be
  //    about a template that is about to change.
  // 2. A param that was provided but cannot make a segment. More specific than
  //    "unresolved", which it would otherwise also trip, since its token was
  //    left in place.
  // 3. A token no param filled.
  //
  // For (3): a mismatch between the path template and the params type would
  // otherwise ship the literal token in the URL AND duplicate the value as a
  // query param — a silently wrong request that looks plausible in a network
  // tab.
  //
  // Substitution above scans the template for tokens using the documented
  // grammar `[a-zA-Z0-9_]` (including one starting with a digit, e.g. `:2fa`),
  // and this detection uses the same grammar, so a token the scan reads but no
  // param fills cannot slip through undetected.
  //
  // A token must BEGIN a path segment. Splitting on '/' and anchoring the
  // match to the start of each segment expresses that without a lookbehind:
  // a colon appearing mid-segment (a time like `12:30`, a port embedded in a
  // path) is never mistaken for a token because it is not at index 0. Phase 1
  // anchors the same way since 5.2.1 (`(^|\/)`, a capture), so the tokens it
  // fills and the tokens this checks are the same set.
  //
  // Lookbehind is avoided deliberately. It is the only construct here that
  // some supported runtimes lack (Safari below 16.4), and an unsupported
  // regex *literal* is a parse-time SyntaxError: it would take down the whole
  // module rather than fail on the one call that used it. For a library whose
  // first promise is "runtime-agnostic", that trade is not worth one regex.
  // -------------------------------------------------------------------------
  if (midSegment.length > 0) {
    throw new TypeError(
      `${midSegment.map(name => `":${name}"`).join(', ')} in path "${path}" can't be filled: a :name must start a ` +
      'path segment. Move it there, or leave out the param of that name.'
    )
  }

  if (unusable.length > 0) {
    throw new TypeError(
      `Path parameter ${unusable.join(', ')} in path "${path}", so the call was not sent. ` +
      'A path parameter must be a non-empty string, a finite number, a bigint or a boolean.'
    )
  }

  const unresolved = resolvedPath
    .split('/')
    .map(segment => /^:[a-zA-Z0-9_]+/.exec(segment)?.[0])
    .filter((token): token is string => !!token)

  if (unresolved.length > 0) {
    throw new TypeError(
      `Unresolved path parameter${unresolved.length > 1 ? 's' : ''} ${unresolved.join(', ')} ` +
      `in path "${path}". Provide ${unresolved.length > 1 ? 'these keys' : 'this key'} in params, ` +
      `or correct the path template.`
    )
  }

  // -------------------------------------------------------------------------
  // Phase 2: Join base and path with exactly one separating slash
  // -------------------------------------------------------------------------
  let url = joinUrl(baseUrl, resolvedPath)

  // -------------------------------------------------------------------------
  // Phase 3: Optional query string serialization
  // -------------------------------------------------------------------------
  // When asQuery is true (typically for GET/DELETE requests), all remaining
  // params are serialized into a URL query string. After serialization,
  // `remaining` is cleared to empty because all params have been consumed.
  // -------------------------------------------------------------------------
  if (asQuery) {
    const searchParams = new URLSearchParams()

    for (const [key, value] of Object.entries(remaining)) {
      // Skip null and undefined — these are intentionally omitted from the
      // query string (the server should treat absent keys as "not provided")
      if (value === null || value === undefined) continue

      if (Array.isArray(value)) {
        // Arrays use repeated keys: tags=a&tags=b
        // This is the most widely supported format across web servers and
        // frameworks (Express, Rails, Django, etc.)
        for (const item of value) {
          searchParams.append(key, String(item))
        }
      } else if (value instanceof Date) {
        // A Date is not a nested object, and the old message sent readers
        // hunting for one. Still refused: ISO 8601 and epoch milliseconds are
        // both common on real APIs, and picking one is the caller's call.
        throw new TypeError(
          `A Date cannot be sent in a query string as is. Convert param "${key}" first, e.g. ${key}: date.toISOString() or date.getTime().`
        )
      } else if (typeof value === 'object') {
        // Nested objects can't be meaningfully serialized as query strings
        // without choosing a convention (brackets, dots, JSON). Rather than
        // picking one and surprising users, we throw a clear error telling
        // them to flatten the data structure first.
        throw new TypeError(`Nested objects are not supported in query strings. Flatten param "${key}" before passing.`)
      } else {
        // Primitive values (string, number, boolean) — convert to string
        searchParams.append(key, String(value))
      }
    }

    // Only append a separator if there are actual query params -- and only a
    // '?' if the URL does not already have one. A `path` template may carry its
    // own query string ('/search/:q?x=1'), and appending a second '?' produced
    // a URL no server parses as intended.
    const query = searchParams.toString()
    if (query) url = `${url}${url.includes('?') ? '&' : '?'}${query}`

    // All remaining params have been consumed by the query string,
    // so return an empty object to signal "nothing left for the body"
    return { url, remaining: {} }
  }

  // When asQuery is false, remaining params are returned as-is for the caller
  // to handle (typically serialized as request body for POST/PUT/PATCH)
  return { url, remaining }
}
