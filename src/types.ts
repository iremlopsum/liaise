// =============================================================================
// types.ts — Foundational type definitions for the liaise library
// =============================================================================
//
// This file contains every shared type used across the library. It is the
// single source of truth for the shapes of configs, results, middleware, and
// the API constructor options.
//
// Why a single types file?
// Having one central place prevents circular import issues (especially between
// result.ts and middleware.ts which both need to reference each other's types).
// The ApiError class lives in result.ts but is re-exported here so every module
// can import it from one place.
// =============================================================================

// ---------------------------------------------------------------------------
// Forward reference for ApiError
// ---------------------------------------------------------------------------
// ApiError is a *class* (not just a type) defined in result.ts. We re-export
// it as a type here so that interfaces like Result<T> and ApiConfig can
// reference it without creating a circular dependency at runtime.
// At runtime, modules that need the actual class import directly from result.ts.
// ---------------------------------------------------------------------------
import type { ApiError, ApiErrorKind } from './result.js'
export type { ApiError, ApiErrorKind }

// ---------------------------------------------------------------------------
// HTTP Method
// ---------------------------------------------------------------------------

/**
 * HTTP methods supported by the library.
 *
 * These are the standard REST methods. Each method has default serialization
 * behavior in the library:
 * - `GET` / `DELETE` → params are serialized as query string (+ path params)
 * - `POST` / `PUT` / `PATCH` → params are serialized as request body
 *
 * This default can be overridden per-request with the `bodyAs` option in
 * {@link RequestConfig}.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

// ---------------------------------------------------------------------------
// Response Type
// ---------------------------------------------------------------------------

/**
 * Determines how the library parses the HTTP response body.
 *
 * - `'json'` (default) — calls `response.json()`, returns parsed object
 * - `'text'` — calls `response.text()`, returns raw string
 * - `'blob'` — calls `response.blob()`, returns a Blob (useful for file downloads)
 * - `'arrayBuffer'` — calls `response.arrayBuffer()`, returns raw binary data
 * - `'formData'` — calls `response.formData()`, returns FormData (rare)
 * - `'none'` — the endpoint returns no body on **success**; `data` is
 *   `undefined`. Any body a *successful* (2xx) response sends anyway is
 *   discarded (and its stream cancelled). This is the accurate declaration
 *   for a 204 endpoint — declare `TResponse` as `undefined` when using it.
 *   This only describes the success shape: a **non-2xx** response is still
 *   read and parsed as JSON for `error.body`, since an error body is
 *   diagnostic (a message, a code) and worth reading even when the caller
 *   wants nothing back on success.
 *
 *   **This is a convention, not a compile-time guarantee.** `new Request<P,
 *   User>({ responseType: 'none' })` is not a type error — a type-level
 *   guard for this was attempted (an overload pair pairing `TResponse` with
 *   a literal `responseType: 'none'`) and dropped: TypeScript's overload
 *   resolution falls through to the general `RequestConfig` overload for
 *   any call the specific one rejects, since that overload has to stay
 *   general to keep accepting a `RequestConfig`-typed variable, a spread of
 *   one, or a factory return (all of which previously — and must still —
 *   compile). A "reject the mismatch" overload with a permissive fallback
 *   sitting right behind it never actually rejects anything: TS just moves
 *   on to the fallback and reports no error, so the guard was pure
 *   ceremony with no effect. Mismatch it and you get a wrong `TResponse`
 *   silently, same as always — declare it as `undefined`.
 *
 *   This describes `new Request`'s behaviour specifically.
 *   `defineRequest` DOES enforce this pairing at compile time — see
 *   `EmptyBodyGuard` in `define-request.ts` — because a curried function,
 *   unlike a constructor, has no permissive overload for the guard to fall
 *   through to.
 *
 * Set this on the {@link RequestConfig} for a specific endpoint. If omitted,
 * the library defaults to `'json'`.
 */
export type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData' | 'none'

// ---------------------------------------------------------------------------
// Request Config
// ---------------------------------------------------------------------------

/**
 * The [Standard Schema](https://standardschema.dev) v1 contract, inlined.
 *
 * Standard Schema is an interface, not a package: Zod, Valibot and ArkType all
 * implement it. Declaring the shape here means a consumer brings their own
 * validator and this library takes no dependency — the zero-dependency pillar
 * holds with nothing added to `package.json`.
 *
 * Only the structural contract is copied, not the published namespace, which
 * has grown a `StandardTypedV1` base since it was written. `validate` plus the
 * phantom `types` is all this library reads, and copying more would mean
 * tracking a moving document for no gain.
 */
export interface StandardSchemaV1<Output = unknown> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>
    readonly types?: { readonly input: unknown; readonly output: Output } | undefined
  }
}

/** One validation failure. `path` is absent for a failure at the root. */
export interface StandardIssue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined
}

/** What a validator hands back: a value, or the reasons it refused. */
export type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardIssue> }

/**
 * The type a schema produces on success — what `data` will be.
 *
 * Infers structurally against the whole `StandardSchemaV1<Output>` interface —
 * conditional-type inference matches `O` wherever it appears in the shape, and
 * here that is `validate`'s return type, `StandardResult<Output> |
 * Promise<StandardResult<Output>>`. THAT is the operative inference site, not
 * the optional `types` phantom: a schema whose `validate` is concretely typed
 * infers correctly even with no `types` property at all, while a schema whose
 * `validate` is widened (e.g. to `unknown`) infers `unknown` even when `types`
 * is present and correctly typed. Do not "simplify" this to
 * `S['~standard']['types']['output']` — that reads the phantom directly and
 * would silently yield `never` or `unknown` for every validator that omits it.
 *
 * Note this is the OUTPUT type: a schema that transforms (a coerced date, a
 * defaulted field) describes what the caller receives, not what the server
 * sent. See `schema` on `RequestConfig`.
 */
export type InferOutput<S> = S extends StandardSchemaV1<infer O> ? O : never

/**
 * Configuration object passed to the `Request` class constructor.
 *
 * Each API endpoint is defined as a `new Request<TParams, TResponse>(config)`.
 * This interface describes the shape of that config.
 *
 * @example
 * ```ts
 * const getUser = new Request<{ id: string }, User>({
 *   method: 'GET',
 *   path: '/users/:id',           // :id is substituted from params
 *   middleware: [cacheMiddleware], // runs only for this endpoint
 *   responseType: 'json',         // default, could be omitted
 * })
 * ```
 */
export interface RequestConfig {
  /** The HTTP method to use for this endpoint. */
  method: HttpMethod

  /**
   * URL path template, relative to the `baseUrl` set in `createApi`.
   *
   * Supports `:param` syntax for path parameters. When the request is made,
   * matching keys from the params object are substituted into the path and
   * excluded from the query string or body.
   *
   * @example '/users/:id'      → params { id: '42' }  → '/users/42'
   * @example '/orgs/:org/repos' → params { org: 'acme' } → '/orgs/acme/repos'
   */
  path: string

  /**
   * Middleware that runs only for this specific endpoint.
   *
   * Execution order: global middleware → per-request middleware → per-call middleware.
   * Each layer wraps the next in an "onion" pattern.
   */
  middleware?: Middleware[]

  /**
   * Default headers sent with every call to this endpoint.
   *
   * Merge precedence (most specific wins):
   * 1. Global headers (from `createApi` config) — lowest priority
   * 2. Per-request headers (this field) — overrides global
   * 3. Per-call headers (from `CallOptions`) — highest priority
   */
  headers?: HeadersInit

  /**
   * How to parse the response body. Defaults to `'json'`.
   * @see {@link ResponseType} for available options.
   */
  responseType?: ResponseType

  /**
   * Optional runtime validation of the successful response body.
   *
   * Bring any [Standard Schema](https://standardschema.dev) validator — Zod,
   * Valibot, ArkType. This library takes no dependency on one.
   *
   * **`data` becomes the schema's output, not the raw body.** A schema that
   * coerces or defaults changes what the caller receives; that is the point of
   * validating through a schema rather than merely checking one. A failure is a
   * `kind: 'parse'` error carrying the issues in `error.body`.
   *
   * Only the **success** body is validated. A non-2xx body is diagnostic and
   * frequently a different shape, so it is left alone.
   *
   * Declaring `responseType: 'none'` alongside a schema is a contradiction —
   * there is no body to validate, and every call will fail validation. It is
   * not rejected at compile time because the runtime failure is immediate and
   * loud.
   *
   * On this class path, `schema` and `TResponse` are also not tied together at
   * compile time: `new Request<P, User>({ ..., schema: numberSchema })`
   * compiles and hands back a `number` typed as `User`, the same class of
   * mismatch as the `responseType: 'none'` case above. `defineRequest` is the
   * path that checks this — see `SchemaConflictGuard` in `define-request.ts`.
   */
  schema?: StandardSchemaV1<unknown>

  /**
   * When `true`, enables auto-cancellation of duplicate in-flight requests.
   *
   * If a new call to this endpoint starts while a previous one is still
   * pending, the previous request is automatically aborted. Useful for
   * search-as-you-type or rapidly changing date filters.
   *
   * Identity is per `Request` instance — each Request object tracks at most
   * one in-flight call.
   *
   * @default false (dedupe is opt-in)
   */
  dedupe?: boolean

  /**
   * Send one network request for identical concurrent calls, instead of one
   * each.
   *
   * Two calls share only if what they would send is identical: the endpoint,
   * method, final URL, final headers and body — compared after every
   * middleware has run, so a header an auth middleware adds (the current
   * user's token) is part of the comparison. Byte-for-byte identical requests
   * cannot be told apart by the server either, which is what makes sharing
   * them safe; anything that differs never shares. Per-call `headers` and
   * `middleware` are judged the same way: identical ones share, and a
   * middleware that changes nothing does not stop sharing.
   *
   * The tracing headers `traceparent`, `tracestate`, `baggage`,
   * `sentry-trace`, `x-request-id` and `x-correlation-id` are left out of the
   * comparison; the shared request goes out with the first caller's values.
   * A body that can't be compared cheaply and safely — `FormData`, `Blob`,
   * `ArrayBuffer`, a typed array, `DataView` or `ReadableStream` — never
   * shares; such a call simply sends its own request. A JSON body is compared
   * as sent, so the same object with its keys in a different order does not
   * share.
   *
   * Every caller runs its own pipeline and gets its own `Result`: its own
   * middleware in both directions, its own `data` (decoded from the one
   * response for each caller; a `Blob`, `ArrayBuffer` or `FormData` is handed
   * over as-is), and its own `result.retry()`, which re-runs that caller's
   * own pipeline with that caller's own options.
   *
   * `onError` fires once per failed shared request, not once per caller. A
   * hung shared request reports once: every caller timing out to the
   * endpoint's (or client's) deadline while waiting is that one failure. If
   * the request then fails another way for callers still waiting, that
   * failure reports too. A caller's own cancel or per-call timeout, or an
   * error its own middleware produces, reports as it would without `share`.
   *
   * A caller that gives up — its `signal`, its own deadline, or a signal a
   * middleware installed — releases only itself: it stops waiting, and the
   * request goes on for the others. The request is cancelled once every
   * caller has given up. A per-call {@link CallOptions.timeout} bounds only
   * its caller. The endpoint's {@link RequestConfig.timeout}, else the
   * client's {@link ApiConfig.timeout}, bounds the shared request itself,
   * measured from when it is sent, so a late joiner cannot extend it. A call
   * arriving after the shared request has settled sends a new one; nothing
   * is cached.
   *
   * Sibling of {@link RequestConfig.dedupe}, not a replacement: dedupe
   * **cancels** the older request, share **joins** the existing one. Setting
   * both throws at `createApi` time.
   *
   * @default false
   */
  share?: boolean

  /**
   * Override the default body serialization strategy.
   *
   * By default, GET/DELETE serialize params as query strings, and
   * POST/PUT/PATCH serialize params as request body (JSON). Use this to
   * override that behavior:
   *
   * - `'query'` — force params to query string (e.g., POST with query params)
   * - `'body'` — force params to request body (e.g., DELETE with JSON body)
   *
   * @example
   * ```ts
   * // DELETE endpoint that expects a JSON body with IDs to delete
   * const bulkDelete = new Request<{ ids: string[] }, { deleted: number }>({
   *   method: 'DELETE',
   *   path: '/items',
   *   bodyAs: 'body',
   * })
   * ```
   */
  bodyAs?: 'query' | 'body'

  /**
   * Abort this request if it has not completed within this many milliseconds.
   *
   * **This is a whole-operation deadline, not a per-attempt budget.** It covers
   * the entire middleware chain including every retry and every backoff delay,
   * so `timeout: 5000` with `retryMiddleware(3)` still means "an answer within
   * 5 seconds" — not five seconds per attempt.
   *
   * For a per-attempt budget, use a signal-replacing middleware placed inside
   * the retry middleware instead:
   *
   * ```ts
   * const perAttempt = (ms: number): Middleware => async (ctx, next) => {
   *   ctx.request.signal = AbortSignal.timeout(ms)
   *   return next()
   * }
   * middleware: [retryMiddleware(3), perAttempt(5000)]
   * ```
   *
   * A timeout produces an error with `kind: 'timeout'` and `status: 0`.
   * `result.retry()` starts a fresh budget. Non-positive means no timeout and
   * stops the fallback to the client's `ApiConfig.timeout`; omitted falls back
   * to it (and to none if that is unset too).
   *
   * This also bounds a middleware that never looks at the signal: one stuck
   * awaiting work of its own (a stalled token refresh) cannot hold the call
   * past the deadline. Once it passes, the chain gets one macrotask to answer
   * by itself; if it has not, the call settles with the timeout Result. The
   * stalled middleware keeps running — a promise cannot be cancelled — but
   * its eventual return value or throw is discarded, and a `next()` it calls
   * afterwards sends nothing. Pass `ctx.request.signal` into such work to
   * actually stop it.
   *
   * Under {@link RequestConfig.share} it also bounds the shared request
   * itself, measured from when that request was sent rather than from when
   * each caller joined, so no individual caller can extend or disable it. Each
   * caller's own pipeline is bounded as usual by the first defined of its
   * {@link CallOptions.timeout}, this, and the client's.
   */
  timeout?: number
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/**
 * A successful API call. `data` is populated, `error` is `null`, and the raw
 * `Response` is always present because the server responded.
 */
export interface SuccessResult<TResponse> {
  /**
   * The parsed response data, narrowed by `error === null`. A 2xx that
   * carries no body under `responseType: 'json'` is a `'parse'` error
   * rather than a success, so this is not `null` for that case — declare
   * `responseType: 'none'` on an endpoint that answers with no body. See the
   * `responseType` reference.
   */
  data: TResponse

  /** Always `null` — this is the discriminant that narrows `data`. */
  error: null

  /**
   * The raw fetch `Response`. Always present on success.
   *
   * For results the library produces, **its body has already been consumed**
   * to produce `data`, so `response.json()` throws "Body has already been
   * read". Use `data`; `response` is for status, headers and redirect
   * metadata. (A `Response` you construct yourself and hand to
   * `successResult()` from `testing.ts` is not affected — its body is still
   * readable.)
   */
  response: Response

  /** Re-execute this request through the full middleware chain. */
  retry: () => Promise<Result<TResponse>>
}

/**
 * A failed API call. `error` is populated and `data` is `null`.
 *
 * `response` is present for HTTP and parse failures (the server responded)
 * and `null` for network failures, aborts, timeouts and middleware errors. Check
 * {@link ApiError.kind} to tell them apart.
 */
export interface ErrorResult<TResponse> {
  /** Always `null` on this branch. */
  data: null

  /** Structured error details. Never `null` on this branch. */
  error: ApiError

  /** The raw `Response`, or `null` when no HTTP response exists. */
  response: Response | null

  /** Re-execute this request through the full middleware chain. */
  retry: () => Promise<Result<TResponse>>
}

/**
 * The result of every API call — a discriminated union on `error`.
 *
 * Checking `error` narrows `data`: after `if (error) return`, `data` is
 * `TResponse`, not `TResponse | null`. That is the whole point of returning
 * a result instead of throwing — the check *is* the narrowing.
 *
 * @example
 * ```ts
 * const { data, error } = await api.getUser({ id: '42' })
 * if (error) {
 *   if (error.kind === 'abort') return       // we cancelled it ourselves
 *   console.error(error.status, error.body)
 *   return
 * }
 * console.log(data.name)   // data is User
 * ```
 */
export type Result<TResponse> = SuccessResult<TResponse> | ErrorResult<TResponse>

// ---------------------------------------------------------------------------
// Call Options
// ---------------------------------------------------------------------------

/**
 * Per-call options available as the optional second argument to any API method.
 *
 * These allow overriding middleware, headers, and cancellation on a
 * call-by-call basis without changing the endpoint definition.
 *
 * @example
 * ```ts
 * // Add extra middleware and an abort signal for this one call
 * const { data } = await api.getItems({ page: 1 }, {
 *   middleware: [customLogMiddleware],
 *   skipMiddleware: [cacheMiddleware],
 *   headers: { 'X-Request-Id': crypto.randomUUID() },
 *   signal: abortController.signal,
 * })
 * ```
 */
export interface CallOptions {
  /**
   * Additional middleware to append for this call only.
   * Runs after global and per-request middleware.
   */
  middleware?: Middleware[]

  /**
   * Middleware to skip for this call, compared by reference identity.
   *
   * ⚠️  Factory-style middleware (like `retryMiddleware(3)`) must be stored
   * in a variable first — passing a new factory call here will create a
   * new reference that won't match the original.
   */
  skipMiddleware?: Middleware[]

  /**
   * Extra headers for this call. Each one replaces the client's and the
   * endpoint's value for the same header; other headers are kept.
   */
  headers?: HeadersInit

  /**
   * An `AbortSignal` to cancel this request. When the signal fires,
   * the fetch is aborted and the result contains an error with `status: 0`
   * and `kind: 'abort'`.
   *
   * It settles the call even while a middleware is still awaiting work that
   * ignores the signal — the same backstop as `RequestConfig.timeout`, which
   * describes it.
   */
  signal?: AbortSignal

  /**
   * Overrides `RequestConfig.timeout` (and the client's `ApiConfig.timeout`)
   * for this call only; the precedence is call, endpoint, client, and `0` at
   * any level stops the fallback. Same whole-operation
   * deadline semantics — see there for details. Non-positive means no timeout.
   *
   * Under `share: true` this bounds only *this* caller. The shared request
   * has a deadline of its own — `RequestConfig.timeout`, else the client's,
   * from when it was sent — so a per-call `timeout: 0` cannot lift it and a
   * longer per-call timeout cannot outlast it.
   *
   * A fractional or out-of-range value is normalised rather than rejected:
   * rounded down to whole milliseconds with a 1 ms minimum, clamped to the
   * platform timer ceiling, and treated as "no timeout" if it is `NaN` or
   * non-positive.
   */
  timeout?: number
}

// ---------------------------------------------------------------------------
// Middleware Types
// ---------------------------------------------------------------------------

/**
 * Context object passed to each middleware function in the chain.
 *
 * Contains all the information about the current request: the HTTP method,
 * the fully-resolved URL, the original path template, the caller's params,
 * the merged headers, and the serialized body.
 *
 * Middleware can read and modify `ctx.request.headers` and `ctx.request.body`
 * before calling `next()` — changes will propagate to the actual fetch call.
 *
 * Middleware is deliberately loosely typed: authors work with `unknown` and
 * cast internally if they need specific types. This avoids complex generic
 * inference issues and keeps middleware composable.
 */
export interface MiddlewareContext {
  /** Mutable request details — middleware can modify headers and body. */
  request: {
    /** HTTP method (GET, POST, etc.) */
    method: string
    /** Fully resolved URL with path params substituted and query string appended. */
    url: string
    /** Original path template (e.g., '/users/:id') — useful for logging. */
    path: string
    /** The original params object passed by the caller. */
    params: unknown
    /** Merged headers — middleware can add/remove headers here. */
    headers: Headers
    /** Serialized request body, or null when there is none. */
    body: unknown | null
    /**
     * The AbortSignal that governs this call's request: the one handed to
     * `fetch`, except when a `share: true` call takes part in a shared
     * request (below).
     *
     * Middleware may read this, or replace it to impose its own cancellation
     * policy — a timeout, a deadline, or a cancel-on-condition rule. The core
     * fetch reads this field at call time, so a replacement made by any
     * middleware takes effect. Under `dedupe: true` the replacement is merged
     * into the dedupe signal rather than discarded: the fetch is then
     * cancelled by whichever fires first, the middleware's signal or a newer
     * call superseding this one.
     *
     * Under `share: true`, a call whose body can be compared (none, a
     * string, `URLSearchParams`) takes part in a shared request, even when
     * it is the only caller. That request is sent with a signal of its own
     * and is cancelled only once every caller has given up. For this caller,
     * the field as it is when `next()` reaches the core fetch is merged with
     * the caller's own `signal` and deadline: whichever fires first, this
     * caller alone stops waiting. A replacement that never fires therefore
     * cannot keep a caller waiting past its own cancel. A `share: true` call
     * whose body can't be compared (`FormData`, `Blob`, `ArrayBuffer`, a
     * typed array, `DataView`, a stream) sends its own request with this
     * field, exactly as without `share`.
     *
     * While middleware runs — before `next()` reaches the core fetch — this
     * holds the caller's `CallOptions.signal` merged with the timeout signal
     * (via `anySignal`) when a `timeout` is configured on the request,
     * operation, or call. It is `undefined` only when neither is present —
     * no `CallOptions.signal` and no effective `timeout`. This is true
     * whether or not dedupe is enabled: the dedupe signal is installed here
     * by the core fetch, so middleware only observes it after `next()`
     * returns.
     *
     * @example
     * ```ts
     * const timeout = (ms: number): Middleware => async (ctx, next) => {
     *   ctx.request.signal = AbortSignal.timeout(ms)
     *   return next()
     * }
     * ```
     */
    signal?: AbortSignal
  }

  /** The key name of the request in the api object (e.g., 'getUser'). */
  requestName: string
}

/**
 * The "next" function passed to middleware. Calling it invokes the next
 * middleware in the chain, or the actual fetch if this is the innermost layer.
 *
 * @typeParam TResponse - The expected response type (always `unknown` in practice).
 */
export type MiddlewareNext<TResponse> = () => Promise<Result<TResponse>>

/**
 * Middleware function signature.
 *
 * Middleware follows the "onion" model (like Koa or Redux middleware):
 * each middleware wraps the next, can modify the request going in and
 * the result coming out.
 *
 * - Call `next()` to proceed to the next layer.
 * - Return early (without calling `next()`) to short-circuit (e.g., cache hit).
 * - Call `next()` multiple times for retry behavior.
 *
 * @example
 * ```ts
 * // Auth middleware — injects a Bearer token into every request
 * const authMiddleware: Middleware = async (ctx, next) => {
 *   ctx.request.headers.set('Authorization', `Bearer ${getToken()}`)
 *   return next()
 * }
 * ```
 *
 * @example
 * ```ts
 * // Short-circuit middleware — returns cached data without hitting the server
 * const cacheMiddleware: Middleware = async (ctx, next) => {
 *   const cached = cache.get(ctx.request.url)
 *   if (cached) return cached
 *   return next()
 * }
 * ```
 */
export type Middleware = (context: MiddlewareContext, next: MiddlewareNext<unknown>) => Promise<Result<unknown>>

// ---------------------------------------------------------------------------
// API Config
// ---------------------------------------------------------------------------

/**
 * Configuration for the `createApi` constructor.
 *
 * This is the top-level config that wires together all request definitions,
 * global middleware, default headers, and error handling into a typed API client.
 *
 * @typeParam TRequests - The record of request definitions (inferred from usage).
 *
 * @example
 * ```ts
 * const api = createApi({
 *   baseUrl: '/api',
 *   requests: { getUser, listUsers, createUser },
 *   middleware: [authMiddleware, logMiddleware],
 *   headers: { 'X-App-Version': '2.0.0' },
 *   onError: (error) => Sentry.captureException(error),
 * })
 * ```
 */
export interface ApiConfig<TRequests extends Record<string, unknown>> {
  /**
   * Base URL prepended to every request path.
   *
   * @example '/api'           → paths become '/api/users', '/api/items', etc.
   * @example 'https://api.example.com' → for absolute URLs
   * @example ''               → same-origin requests (path used as-is)
   */
  baseUrl: string

  /**
   * Record of Request instances. Each key becomes a method on the API object.
   *
   * @example { getUser, listUsers, createUser } → api.getUser(), api.listUsers(), etc.
   */
  requests: TRequests

  /**
   * A deadline for every call this client makes, in milliseconds. No default.
   *
   * The most specific level wins: a per-call `timeout`, then the endpoint's
   * (`RequestConfig.timeout` / `OperationConfig.timeout`), then this one. `0`
   * or a negative value at any level means "no deadline" and stops the
   * fallback, so `timeout: 0` on an endpoint opts it out of this default.
   * Like every liaise timeout it covers the whole operation, retries included.
   * Under `share`, it is also the shared request's deadline when the endpoint
   * sets none, measured from when that request is sent.
   */
  timeout?: number

  /**
   * Global middleware applied to every request.
   * Runs first in the middleware chain (before per-request and per-call middleware).
   */
  middleware?: Middleware[]

  /**
   * Default headers sent with every request.
   * Lowest merge priority — overridden by per-request and per-call headers.
   */
  headers?: HeadersInit

  /**
   * Global error callback. Fires after the full middleware chain completes,
   * just before the result is returned to the caller.
   *
   * Only fires when the **final** result has an error. If a retry middleware
   * recovers a 5xx to a 200, this does NOT fire.
   *
   * Fires for HTTP errors (4xx, 5xx), network errors (status 0), timeouts
   * (`kind: 'timeout'`), parse failures (`kind: 'parse'`), and middleware
   * failures (`kind: 'middleware'`). Does NOT fire for `kind: 'abort'` — a
   * caller's own `AbortSignal` firing, or a request superseded by dedupe, is
   * a cancellation the library caused deliberately, not a failure worth
   * reporting to an error tracker. The caller still gets the abort back in
   * the `Result` either way; only the report to this callback is suppressed.
   *
   * @example
   * ```ts
   * onError: (error) => {
   *   if (error.status === 401) redirectToLogin()
   *   Sentry.captureException(error)
   * }
   * ```
   */
  onError?: (error: ApiError) => void
}

// ---------------------------------------------------------------------------
// Retry Options (for retryMiddleware)
// ---------------------------------------------------------------------------

/** Information handed to {@link RetryOptions.onRetry} before each retry. */
export interface RetryInfo {
  /** 1-based retry number — the first retry is 1. */
  attempt: number
  /** The configured maximum number of retries. */
  max: number
  /** The delay about to elapse, in ms, after jitter and `Retry-After`. */
  delay: number
  /** The result that triggered this retry. */
  result: Result<unknown>
}

/** Options for {@link retryMiddleware}. */
export interface RetryOptions {
  /** Additional attempts after the first. Default 3. */
  max?: number
  /** Delay curve. Default `'exponential'`. */
  delay?: 'exponential' | 'linear' | ((attempt: number) => number)
  /** First delay in ms. Default 250. */
  baseDelay?: number
  /** Per-delay cap in ms. Default 30000. */
  maxDelay?: number
  /** Full jitter — uniform random in `[0, computed]`. Default true. */
  jitter?: boolean
  /** Honour a `Retry-After` response header when present. Default true. */
  respectRetryAfter?: boolean
  /**
   * Whether to retry. Default `r => (r.error?.status ?? 0) >= 500`.
   *
   * 429 and network errors are deliberately not retried by default; opt in
   * explicitly rather than having behaviour change under you on upgrade.
   */
  retryOn?: (result: Result<unknown>, attempt: number) => boolean
  /**
   * Observational hook fired before each retry's delay elapses. Its return
   * value is ignored and a throw cannot fail the request.
   *
   * This exists because the call site observes nothing during retries: the
   * promise stays pending through every attempt and resolves exactly once.
   */
  onRetry?: (info: RetryInfo) => void
}

// ---------------------------------------------------------------------------
// GraphQL Types
// ---------------------------------------------------------------------------

/**
 * Configuration object for the `Operation` class constructor.
 *
 * The `operation` field holds the GraphQL document string. It is sent to the
 * server under the key `"query"` (per the GraphQL over HTTP spec), but is
 * named `operation` here to make clear it can be a query or mutation.
 */
export interface OperationConfig {
  /** The GraphQL document string. Sent as `{ query: ... }` on the wire. */
  operation: string

  /**
   * Middleware that runs only for this specific operation.
   *
   * Execution order: global middleware → per-operation middleware → per-call middleware.
   * Each layer wraps the next in an "onion" pattern.
   */
  middleware?: Middleware[]

  /**
   * Default headers for this operation.
   *
   * Merge precedence (most specific wins):
   * 1. Global headers (from `createGraphQL` config) — lowest priority
   * 2. Per-operation headers (this field)
   * 3. Per-call headers (from `CallOptions`) — highest priority
   */
  headers?: HeadersInit

  /**
   * When `true`, enables auto-cancellation of duplicate in-flight requests.
   *
   * If a new call to this operation starts while a previous one is still
   * pending, the previous request is automatically aborted.
   *
   * @default false
   */
  dedupe?: boolean

  /**
   * Optional runtime validation of the GraphQL response's `data`.
   *
   * Same contract as `RequestConfig.schema`: any Standard Schema validator, no
   * dependency taken, `data` becomes the schema's output, and a failure is a
   * `kind: 'parse'` error with the issues in `error.body`.
   *
   * Unlike the REST side, a schema here does **not** supply the response type —
   * `Operation`'s `TData` stays explicit, because only the REST pipeline has a
   * factory that can infer it.
   */
  schema?: StandardSchemaV1<unknown>

  /**
   * Abort this operation if it has not completed within this many
   * milliseconds.
   *
   * **This is a whole-operation deadline, not a per-attempt budget** — see
   * {@link RequestConfig.timeout} for the full rationale, which applies
   * identically here — including that it bounds a middleware which never
   * looks at the signal. A timeout produces an error with `kind: 'timeout'` and
   * `status: 0`. `result.retry()` starts a fresh budget. Non-positive means no
   * timeout, and stops the fallback to the client's `GraphQLBaseConfig.timeout`;
   * omitted falls back to it (and to none if that is unset too).
   */
  timeout?: number
}

/**
 * A single GraphQL error as returned by the server in `{ errors: [...] }`.
 * Mirrors the GraphQL spec error shape.
 */
export interface GraphQLError {
  /** Human-readable description of the error. */
  message: string
  /** Character positions in the GraphQL document where the error originated. */
  locations?: Array<{ line: number; column: number }>
  /** Path to the response field that produced the error, for partial responses. */
  path?: Array<string | number>
  /** Server-defined additional metadata about the error. */
  extensions?: Record<string, unknown>
}

/**
 * Base configuration shared by both `createGraphQL` overloads.
 */
export interface GraphQLBaseConfig {
  /** The full URL of the GraphQL endpoint, e.g. `'https://api.example.com/graphql'`. */
  endpoint: string

  /**
   * A deadline for every call this client makes, in milliseconds. No default.
   *
   * The most specific level wins: a per-call `timeout`, then the endpoint's
   * (`RequestConfig.timeout` / `OperationConfig.timeout`), then this one. `0`
   * or a negative value at any level means "no deadline" and stops the
   * fallback, so `timeout: 0` on an endpoint opts it out of this default.
   * Like every liaise timeout it covers the whole operation, retries included.
   */
  timeout?: number

  /**
   * Global middleware applied to every operation.
   * Runs first in the middleware chain (before per-operation and per-call middleware).
   */
  middleware?: Middleware[]

  /**
   * Default headers sent with every operation.
   * Lowest merge priority — overridden by per-operation and per-call headers.
   */
  headers?: HeadersInit

  /**
   * Global error callback. Fires after the full middleware chain completes.
   *
   * Fires for GraphQL errors (any 2xx with `{ errors }`), HTTP errors (4xx/5xx),
   * network errors (status 0), timeouts (`kind: 'timeout'`), parse failures
   * (`kind: 'parse'`), and middleware failures (`kind: 'middleware'`). Does
   * NOT fire when the result is successful, and does NOT fire for
   * `kind: 'abort'` — a caller's own `AbortSignal` firing, or a request
   * superseded by dedupe, is a cancellation the library caused deliberately,
   * not a failure worth reporting to an error tracker. The caller still gets
   * the abort back in the `Result` either way; only the report to this
   * callback is suppressed.
   */
  onError?: (error: ApiError) => void
}
