// =============================================================================
// create-api.ts — The core API client constructor for the liaise library
// =============================================================================
//
// This is the heart of the library. It takes a set of Request definitions and
// wires them together with middleware, headers, and the native fetch API into a
// typed API object where each key becomes a callable method.
//
// The flow for each API call:
//
//   1. Caller invokes api.getUser({ id: '42' }, { signal, headers, ... })
//   2. createApi's generated method:
//      a. Builds the URL (path param substitution + optional query string)
//      b. Merges headers (global < per-request < per-call)
//      c. Serializes the body (JSON, FormData, etc.)
//      d. Computes the effective abort signal (with dedupe if enabled)
//      e. Composes middleware (global + per-request + per-call, minus skipped)
//      f. Executes the composed chain → core fetch → returns Result. Under
//         share: true, core joins an identical request already in flight
//         instead of sending its own — identical meaning what is about to go
//         on the wire, after every middleware ran for this caller
//      g. Fires onError if the final result has an error
//
// The generated methods are fully typed — TypeScript infers the params and
// response types from the Request<TParams, TResponse> generics. When TParams
// is Record<string, never>, the params argument becomes optional.
//
// Design decisions:
// - retry() re-enters execute(), which rebuilds the full middleware chain.
//   This ensures auth tokens, logging, etc. all fire again on retry.
// - The entire execute() body is wrapped in try/catch to handle synchronous
//   errors (e.g., TypeError from buildUrl for nested objects in query strings).
//   These are returned as Result errors, not unhandled rejections.
// - onError fires AFTER the middleware chain, so retry middleware can recover
//   errors without triggering the global error handler.
// - Dedupe integration is handled transparently — when a Request has
//   dedupe: true, the signal is routed through a DedupeTracker that
//   auto-cancels previous in-flight requests for the same endpoint.
// =============================================================================

import { Request } from './request.js'
import { ApiError, createSuccessResult, createErrorResult, createNetworkErrorResult } from './result.js'
import { composeMiddleware } from './middleware.js'
import { buildUrl, joinUrl, TemplateError } from './utils/path-params.js'
import { serializeBody } from './utils/serialize.js'
import { DedupeTracker } from './utils/dedupe.js'
import { callLoggerFor } from './utils/log.js'
import { ShareTracker, requestKey, narrowTag, stampShared, stampPreempted } from './utils/share.js'
import type { SharedRound } from './utils/share.js'
import { mergeHeaders, headersRecord } from './utils/headers.js'
import { mergeFetchOptions, sendableFetchOptions } from './utils/fetch-options.js'
import { abortKind, propagatesReason } from './utils/abort-kind.js'
import { anySignal, releaseSignal } from './utils/any-signal.js'
import { callBudget } from './utils/budget.js'
import { timeoutSignalFor } from './utils/timeout.js'
import { createBackstop } from './utils/backstop.js'
import { isReadableStream } from './utils/special-body.js'
import { classifyParams } from './utils/classify-params.js'
import { runSchema } from './utils/validate.js'
import type { SchemaOutcome } from './utils/validate.js'
import { sendExchange, sendSharedExchange, AbortedRead } from './utils/exchange.js'
import type { Exchange } from './utils/exchange.js'
import { stampClientFetch } from './utils/client-fetch.js'
import { originalState, nextCopy, pollKeyOf, stampCopier, stampPollId, type CopyState } from './utils/copy.js'
import type { ApiConfig, CallOptions, EndpointExtras, ErrorResult, Middleware, MiddlewareContext, Result, ResponseType } from './types.js'

// =============================================================================
// Type helpers — these bridge Request generics to the API method signatures
// =============================================================================

/**
 * Extracts the TParams type from a Request instance.
 *
 * Given `Request<{ id: string }, User>`, this resolves to `{ id: string }`.
 * Used internally by the Api mapped type to infer method parameter types.
 *
 * @typeParam R - A Request instance (or anything — returns `never` for non-Request types).
 */
type ExtractParams<R> = R extends Request<infer P, any> ? P : never

/**
 * Extracts the TResponse type from a Request instance.
 *
 * Given `Request<{ id: string }, User>`, this resolves to `User`.
 * Used internally by the Api mapped type to infer method return types.
 *
 * @typeParam R - A Request instance (or anything — returns `never` for non-Request types).
 */
type ExtractResponse<R> = R extends Request<any, infer Res> ? Res : never

/**
 * Defines the signature of a generated API method.
 *
 * The key trick here is the conditional type: when TParams is
 * `Record<string, never>` (an empty object — meaning the endpoint takes no
 * params), the `params` argument becomes optional. This allows callers to
 * write `api.health()` instead of `api.health({})`.
 *
 * The condition `Record<string, never> extends TParams` works because:
 * - When TParams IS Record<string, never>, the condition is true → optional params
 * - When TParams has required keys (e.g., { id: string }), Record<string, never>
 *   does NOT extend it → required params
 *
 * @typeParam TParams - The params type for this endpoint.
 * @typeParam TResponse - The response type for this endpoint.
 */
type ApiMethod<TParams extends object, TResponse> =
  (Record<string, never> extends TParams
    ? (params?: TParams, options?: CallOptions) => Promise<Result<TResponse>>
    : (params: TParams, options?: CallOptions) => Promise<Result<TResponse>>) & EndpointExtras

/**
 * The typed API object returned by createApi.
 *
 * This is a mapped type that transforms a record of Request instances into
 * a record of callable methods. Each key from the `requests` config becomes
 * a method with fully typed params and response.
 *
 * @example
 * ```ts
 * // Given:
 * const requests = {
 *   getUser: new Request<{ id: string }, User>({ ... }),
 *   listUsers: new Request<Record<string, never>, User[]>({ ... }),
 * }
 *
 * // Api<typeof requests> resolves to:
 * {
 *   getUser: (params: { id: string }, options?: CallOptions) => Promise<Result<User>>
 *   listUsers: (params?: Record<string, never>, options?: CallOptions) => Promise<Result<User[]>>
 * }
 * ```
 *
 * @typeParam TRequests - The record of Request instances from the config.
 */
type Api<TRequests extends Record<string, Request<any, any>>> = {
  [K in keyof TRequests]: ApiMethod<ExtractParams<TRequests[K]>, ExtractResponse<TRequests[K]>>
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Every ReadableStream body already handed to fetch. A stream can be read
 * once: a second attempt (retryMiddleware, result.retry(), a middleware that
 * calls next() twice) would otherwise send an empty or broken body. A WeakSet
 * so a finished stream is not kept alive by this record.
 */
const sentStreams = new WeakSet<ReadableStream>()

/**
 * Returned by `decodeBody` when a `json` request received an empty body.
 *
 * Distinct from `null` because `JSON.parse("null")` is also `null`: a server
 * sending the body `null` is sending valid JSON and must not be confused with
 * one sending nothing at all. Module-private — it never reaches the barrel.
 *
 * The success path turns this into a `kind: 'parse'` error. The non-2xx path
 * normalizes it to `null` for `error.body` instead: a failure is already
 * being reported there, and the empty body is only diagnostic.
 */
const EMPTY_JSON_BODY: unique symbol = Symbol('liaise.emptyJsonBody')

/**
 * This caller's own copy of the body, decoded from the one shared read.
 * Throws what reading or parsing threw, so the call sites' existing try/catch
 * blocks keep classifying failures as before.
 *
 * The read itself happened once, in `sendExchange` (src/utils/exchange.ts),
 * which also cancelled the stream for a 2xx under 'none'. A read the
 * request's own signal aborted never reaches here: `sendExchange` throws it
 * as an `AbortedRead`, and core's outer catch classifies it. What can reach
 * here is a read that failed for another reason (rethrown as-is) or a body
 * that does not parse.
 *
 * Special handling for JSON: the body arrives as text and is parsed here.
 * This avoids the "unexpected end of input" error that response.json() throws
 * on empty responses (e.g., 204 No Content, or a 200 with an empty body, which
 * DELETE and fire-and-forget endpoints do send). Empty text yields the
 * EMPTY_JSON_BODY sentinel rather than throwing; each call site decides what
 * an empty body means for it.
 *
 * @param exchange - The round trip's single read.
 * @param responseType - How to decode it. Defaults to 'json', and so does a
 *   value this switch does not name, exactly as the read in `sendExchange`
 *   falls back to text for one.
 * @returns The decoded body (type depends on responseType).
 */
function decodeBody(exchange: Exchange, responseType: ResponseType = 'json'): unknown {
  if (exchange.readFailed) throw exchange.readError
  switch (responseType) {
    case 'text':
    case 'blob':
    case 'arrayBuffer':
    case 'formData':
      // Already in its final form: text, or the native object the read produced.
      return exchange.body
    case 'none':
      // The caller has declared this endpoint returns no body, so there is
      // nothing to decode; `sendExchange` cancelled whatever the server sent.
      return undefined
    case 'json':
    default: {
      // Read as text first so an empty body is reported, not thrown — see the
      // EMPTY_JSON_BODY seam.
      const text = exchange.body as string
      return text ? JSON.parse(text) : EMPTY_JSON_BODY
    }
  }
}

/**
 * Builds the request's URL, plus the two flags Step 4's later steps need
 * alongside it.
 *
 * One implementation, two callers: Step 4 inside `execute()`, and
 * `urlForError` below. That is the entire reason it exists as a function.
 * Step 4 is not a `buildUrl` call — it is the `shouldSerializeAsQuery` getter,
 * the `classifyParams` decision, and a conditional `{}` substitution wrapped around
 * one. An error path that hand-reproduced that would be free to drift from the
 * real one, which is why recomputing the URL for diagnostics was rejected
 * before this extraction existed.
 *
 * Throws whatever `buildUrl` throws — an unresolved `:token`, or a nested
 * object reaching a query string. Step 4 lets that propagate to `execute()`'s
 * setup catch; `urlForError` catches it and falls back to the template.
 */
function resolveRequestUrl(
  baseUrl: string,
  request: Request<any, any>,
  params: object
): { url: string; remaining: Record<string, unknown>; asQuery: boolean; whole: { value: unknown } | null } {
  // Respects the bodyAs config override, then the HTTP method default.
  const asQuery = request.shouldSerializeAsQuery
  // Throws a TypeError for params with no honest wire form; see classify-params.ts.
  const classified = classifyParams(params, asQuery)
  const { url, remaining } = buildUrl(
    baseUrl,
    request.config.path,
    classified.kind === 'fields' ? classified.fields : {},
    asQuery
  )
  return { url, remaining, asQuery, whole: classified.kind === 'whole' ? { value: classified.value } : null }
}

/**
 * The most accurate URL that can be named for an error report.
 *
 * `buildFailedResult`'s default: used by every failure with no `Response`
 * behind it that did not capture a URL of its own — `execute()`'s setup catch,
 * and the backstop's last-resort `onFailure`. Each of those names the address
 * the call was *for*, which is what `error.request.url` documents; it is not a
 * claim that bytes went there. 4.0.1 settled that reading when a middleware
 * failing before `fetch` started reporting the resolved URL.
 *
 * The `catch` is load-bearing on exactly one path: when `buildUrl` is what
 * threw, no URL was ever resolvable and the un-substituted template is the
 * only honest answer. `buildUrl` throws a second time here to establish that —
 * harmless, and only on a path that is already failing.
 *
 * Deliberately not memoized: the recompute is identical for identical inputs,
 * so a cache would buy nothing on a path that is already failing. `params`
 * reaches middleware by reference, so an in-place mutation there can make the
 * recompute differ from what Step 4 built; a cache would not fix that either,
 * and the URL is still correct for the params as they now are.
 */
function urlForError(baseUrl: string, request: Request<any, any>, params: object): string {
  try {
    return resolveRequestUrl(baseUrl, request, params).url
  } catch (err) {
    // A template failure — a fragment, or (5.2.1) a `:name` in the path's
    // query string — knows the URL the call was for: substitution ran before
    // it threw, so the report names '/users/42#f' rather than the raw
    // '/users/:id#f' template (BACKLOG §2.7). Every other setup failure — the
    // nested query object, an unfilled or mid-segment token — genuinely has no
    // resolved URL to offer, and the template is the only honest answer there.
    if (err instanceof TemplateError) return err.resolvedUrl
    return joinUrl(baseUrl, request.config.path)
  }
}

/**
 * Builds a `Result` for a failure that never reached (or never came back
 * from) `core()`, so there is no `Response` to report and no HTTP status.
 *
 * Three situations produce one:
 *
 * - the backstop settling a call whose own signal aborted while its chain had
 *   not answered (`'abort'`, or `'timeout'` by that signal's reason) — see
 *   utils/backstop.ts;
 * - a synchronous error during request setup (`'network'`), most often the
 *   `TypeError` `buildUrl` throws for a nested query-string object;
 * - a rejection escaping the middleware chain (`'middleware'`, or `'network'`
 *   for a setup failure).
 *
 * Classification is by **provenance**, not by sniffing `reason`'s shape: a
 * failure only counts as *our* cancellation when `signal` — the AbortSignal
 * that actually governs this operation — is the one that aborted. That is
 * what lets a caller's custom abort reason (`ac.abort(new Error('x'))`, or a
 * plain string) still classify as `'abort'`/`'timeout'` instead of falling
 * through to `'network'` — `abortKind` only recognises the standard
 * `AbortError`/`TimeoutError` names, but the signal itself always knows why
 * it aborted regardless of what shape its `reason` takes.
 *
 * For a `'middleware'` fallback this additionally requires `reason` to
 * *propagate* `signal.reason` (see `propagatesReason` — exact identity, or
 * one level of `.cause`). A middleware can throw its own `AbortError`-named
 * failure that has nothing to do with this request's own signal — a
 * rethrown IndexedDB quota abort, say — and that must stay `'middleware'`,
 * not be swallowed as `'abort'` just because the name matches. Propagation
 * is a heuristic for that, not proof — `propagatesReason`'s doc names the
 * known false positive (a middleware's own error using `{ cause }` to
 * explain *why* it failed, not to claim it *is* the cancellation) — but it's
 * the closest approximation available, and rejecting it in favour of exact
 * identity alone is measurably worse (see the same doc). A non-`'middleware'`
 * fallback doesn't need that check: a fetch rejection while our own signal
 * is aborted IS that cancellation, whatever shape fetch happened to throw.
 *
 * `error.request.url` here is exactly the `url` argument passed in below —
 * see `buildFailedResult`'s doc, inside `createApi`, for where it comes from.
 * Every call site reports a resolved, path-substituted address: the two
 * `'middleware'` sites pass `context.request.url` explicitly, because only
 * they can observe a middleware that rewrote it, and everything else takes
 * `urlForError`, which rebuilds it through the same `resolveRequestUrl` Step 4
 * uses. The un-substituted template survives in one case only — `buildUrl`
 * itself threw, so no URL was ever resolvable.
 */
function syntheticResult(
  reason: unknown,
  signal: AbortSignal | undefined,
  fallbackKind: 'abort' | 'network' | 'middleware',
  method: string,
  url: string,
  params: unknown,
  retry: () => Promise<Result<unknown>>
): ErrorResult<unknown> {
  const isOurCancellation =
    signal?.aborted === true &&
    (fallbackKind !== 'middleware' || propagatesReason(reason, signal.reason))
  const kind = isOurCancellation ? (abortKind(signal!.reason) ?? 'abort') : fallbackKind
  const error = new ApiError({
    kind,
    status: 0,
    statusText: '',
    body: reason,
    headers: new Headers(),
    request: { method, url, params }
  })
  return createNetworkErrorResult(error, retry)
}

// =============================================================================
// createApi — the main export
// =============================================================================

/**
 * Creates a typed API client from a set of Request definitions.
 *
 * This is the primary entry point of the liaise library. It takes a configuration
 * object containing a base URL, request definitions, optional global middleware,
 * default headers, and an error callback, and returns an object where each request
 * key becomes a callable, fully-typed method.
 *
 * **How it works internally:**
 *
 * For each Request in the `requests` record, createApi generates a method that:
 * 1. Builds the URL from baseUrl + path template + params (path param substitution)
 * 2. Merges headers from three layers (global < per-request < per-call)
 * 3. Serializes the body (JSON for plain objects, passthrough for FormData/Blob/etc.)
 * 4. Computes the effective abort signal (includes dedupe tracking if enabled)
 * 5. Composes the middleware chain (global → per-request → per-call, minus skipped)
 * 6. Executes the chain, with the core fetch as the innermost layer
 * 7. Fires the onError callback if the final result has an error
 *
 * Every call runs all of that for itself, `share: true` included: sharing
 * happens inside the core fetch, on the request as it is about to be sent.
 *
 * **Dedupe integration:**
 *
 * A single DedupeTracker instance is created per createApi call. When a Request
 * has `dedupe: true`, the abort signal is routed through the tracker before being
 * passed to fetch. This means that firing a new request for the same endpoint
 * automatically cancels any previous in-flight request — perfect for
 * search-as-you-type, paginated lists, or rapidly changing filters.
 *
 * **Error handling philosophy:**
 *
 * The library never throws — every outcome is expressed as a Result<T>.
 * - HTTP errors (4xx, 5xx) → Result with error, response, and retry
 * - Network errors → Result with error (status 0), null response, and retry
 * - Synchronous errors (e.g., TypeError from query string serialization) → same
 *
 * @typeParam TRequests - Record of Request instances. Keys become method names,
 *   and the Request's TParams/TResponse generics become the method's signature.
 *
 * @param config - API configuration with baseUrl, requests, middleware, headers, onError.
 * @returns A typed object where each request key is a callable method.
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
 *
 * // Fully typed: params and response inferred from Request generics
 * const { data, error, retry } = await api.getUser({ id: '42' })
 * ```
 */
export function createApi<TRequests extends Record<string, Request<any, any>>>(
  config: ApiConfig<TRequests>
): Api<TRequests> {
  // Destructure the config for convenience. Default globalMiddleware to an
  // empty array so we don't need null checks throughout the function.
  const { baseUrl, requests, middleware: globalMiddleware = [], headers: globalHeaders, onError, timeout: clientTimeout, fetch: clientFetch, fetchOptions: clientFetchOptions } = config
  // Not a middleware: each call prints its start line before its chain runs
  // and its end line from the post-execution hook, with the Result the caller
  // receives — the backstop's too — so it logs once, with its final outcome
  // (utils/log.ts). Null when off.
  const logger = callLoggerFor(config.log)

  /**
   * Calls the consumer's `onError`, swallowing anything it throws.
   *
   * `onError` is a user callback on the one path that must never fail: it
   * runs *after* the result is in hand, so an exception from it would reject
   * a promise that already has a perfectly good `Result` to hand back — the
   * caller would see a throw for a request that merely returned a 500. A
   * Sentry client in a misconfigured environment, or a logger dereferencing
   * `error.response.status`, is all it takes. Same stance as `retryOn`,
   * `onRetry` and the custom `delay` curve in `built-in-middleware.ts`.
   */
  const fireOnError = (error: ApiError): void => {
    // Aborts are cancellations we caused — a caller's own signal, or a newer
    // request superseding this one under dedupe. Reporting them to an error
    // tracker is noise. Timeouts are deliberately NOT suppressed: a deadline
    // you missed is a genuine failure, which is why the two kinds are separate.
    if (error.kind === 'abort') return
    if (!onError) return
    try {
      onError(error)
    } catch {
      /* swallowed by contract — onError cannot fail a request */
    }
  }

  // ---------------------------------------------------------------------------
  // Dedupe tracker — shared across all endpoints in this API instance.
  //
  // Each endpoint that has dedupe: true will use this tracker to auto-cancel
  // previous in-flight requests. The tracker is per-createApi (not global)
  // because different API instances should have independent dedupe state.
  // ---------------------------------------------------------------------------
  const dedupeTracker = new DedupeTracker()

  // ---------------------------------------------------------------------------
  // Share tracker — shared across all endpoints in this API instance, same
  // per-createApi lifetime rationale as dedupeTracker above.
  //
  // Under share: true, core() joins an identical request already in flight
  // instead of sending its own (see the share step in core). share and
  // dedupe are opposites (share joins the existing request, dedupe cancels
  // it), so a Request that sets both is a contradiction with no
  // sensible combined semantics. Validate this up front, at construction
  // time, rather than at call time: it's the one sanctioned throw outside a
  // Result, because it's a configuration mistake, not a request failure.
  // ---------------------------------------------------------------------------
  const shareTracker = new ShareTracker()

  for (const [name, request] of Object.entries(requests)) {
    if (request.config.share && request.config.dedupe) {
      throw new Error(
        `Request "${name}" sets both share and dedupe. They are opposites — ` +
        `dedupe cancels the previous call, share joins it. Pick one.`
      )
    }
  }

  // Snapshot once: a `requests` record mutated after createApi must not give a
  // copy endpoints the original lacks.
  const entries = Object.entries(requests)

  /**
   * Builds the client — the original, or a copy `withHeaders` asked for —
   * from `copy`. Everything outside this function (the trackers, the logger,
   * `fireOnError`, the config) is shared by every copy through the closure,
   * which is what the spec decides they share. `origin` is the original
   * client's endpoints, or null while building the original itself: a copy's
   * endpoints are stamped with it so polls can share between copies (poll.ts).
   */
  const build = (copy: CopyState, origin: Record<string, Function> | null): Record<string, Function> => {
    // The api object is built up imperatively by iterating over the requests
    // record. Each key becomes a method on the api object.
    // We use `Record<string, Function>` internally because the precise types
    // are enforced by the return type cast `as Api<TRequests>` at the end.
    const api = {} as Record<string, Function>

    for (const [name, request] of entries) {
      // =========================================================================
      // Generate the API method for this request definition
      // =========================================================================
      // Each iteration creates a closure that captures `name` and `request`.
      // The generated method accepts optional params and call options.
      // =========================================================================
      api[name] = (params: object = {}, options: CallOptions = {}): Promise<Result<unknown>> => {
        /**
         * A `Result` for a failure with no `Response` behind it — construction
         * only, no reporting. A function declaration rather than a const so it
         * can name `retry` (as the Result's `retry`) before that binding exists
         * further down.
         *
         * Split out of `failedResult` (below) because most call sites hand the
         * Result to the post-execution hook, which decides reporting itself;
         * only the two sites outside that hook report as they build.
         *
         * `url`, when supplied, overrides the default. The sites inside
         * `execute()` that can see the middleware context pass
         * `context.request.url` — that reflects a middleware which rewrote the
         * URL, which nothing recomputed here could know about.
         *
         * Every other site takes the default, `urlForError`, which rebuilds the
         * address through the same `resolveRequestUrl` Step 4 uses, from this
         * caller's own params. Every caller runs its own `execute()`, `share:
         * true` included, so there is no second caller whose view of the URL
         * this one could disagree with.
         */
        function buildFailedResult(
          reason: unknown,
          signal: AbortSignal | undefined,
          fallbackKind: 'abort' | 'network' | 'middleware',
          url?: string
        ): ErrorResult<unknown> {
          return syntheticResult(
            reason,
            signal,
            fallbackKind,
            request.config.method,
            url ?? urlForError(baseUrl, request, params),
            params,
            retry
          )
        }

        /**
         * `buildFailedResult` plus reporting to `onError` — the common case,
         * used everywhere a failure has no other path to the error tracker.
         */
        function failedResult(
          reason: unknown,
          signal: AbortSignal | undefined,
          fallbackKind: 'abort' | 'network' | 'middleware'
        ): ErrorResult<unknown> {
          const result = buildFailedResult(reason, signal, fallbackKind)
          fireOnError(result.error as ApiError)
          return result
        }

        /**
         * The execute function encapsulates the entire request lifecycle.
         *
         * Every Result's `retry` re-enters it (through `retry`, below) from
         * scratch — rebuilding the URL, re-merging headers, re-composing
         * middleware, and re-executing the fetch. This ensures that retry
         * always goes through the full pipeline (auth re-injection, logging,
         * etc.), with this caller's own options.
         *
         * Every call runs its own execute(), `share: true` included: setup,
         * middleware in both directions, its own deadlines and signal, its own
         * Result and its own onError decision. Sharing is the innermost step
         * only — core() joins an identical request already in flight instead
         * of sending its own (see the share step there).
         *
         * The entire body is wrapped in try/catch to capture synchronous
         * errors (e.g., TypeError from buildUrl when a nested object is
         * passed as a query string param). These are returned as Result
         * errors rather than unhandled rejections, keeping the "never throws"
         * contract intact.
         */
        const execute = (): Promise<Result<unknown>> => {
          // Every merged signal this run creates. Released once the run has a
          // Result (or its setup failed), so a long-lived caller signal does not
          // collect one listener per call. Released after settlement, never
          // when fetch returns: a retrying middleware calls next() again and
          // must still see a live signal. See releaseSignal in any-signal.ts.
          //
          // `own` records a signal only when it is none of its inputs. anySignal
          // hands back its sole defined input unchanged, and that input may be a
          // merge some other, still-running call owns: a middleware forwarding
          // ctx.request.signal into a nested api call makes the nested call's
          // budget the outer call's own merge. Releasing that would cut the
          // outer call loose from its caller's signal.
          const merged: AbortSignal[] = []
          const own = (signal: AbortSignal | undefined, ...inputs: (AbortSignal | undefined)[]): void => {
            if (signal && !inputs.includes(signal)) merged.push(signal)
          }
          const releaseAll = (): void => { for (const s of merged) releaseSignal(s) }
          try {
            // -----------------------------------------------------------------
            // Step 1: Compose the middleware chain
            // -----------------------------------------------------------------
            // Middleware runs in this order: global → per-request → per-call.
            // This matches the "most general to most specific" convention.
            // Global middleware (auth, logging) wraps everything. Per-request
            // middleware (validation, caching) wraps the specific endpoint.
            // Per-call middleware (one-off customizations) is innermost. The
            // client's `log` is not in this list: it wraps the whole call, at
            // Steps 8 and 9.
            // -----------------------------------------------------------------
            const allMiddleware: Middleware[] = [
              ...globalMiddleware,
              ...(request.config.middleware ?? []),
              ...(options.middleware ?? [])
            ]

            // -----------------------------------------------------------------
            // Step 2: Compute the effective abort signal
            // -----------------------------------------------------------------
            // The caller's signal is the starting point, and it is what the
            // context carries into the middleware chain. When dedupe is enabled
            // the real registration happens inside core() — see below — so that
            // a middleware which short-circuits (a cache hit) never cancels a
            // live request that is genuinely in flight, and so that a signal
            // installed by middleware is an input to dedupe rather than
            // something dedupe overwrites.
            //
            // dedupeController doubles as the "already registered" flag: it is
            // set on the first attempt that reaches core() and survives across
            // retries, which keeps registration once per execute().
            // -----------------------------------------------------------------
            // Resolve the deadline: per-call, then per-request, then the
            // client's — the first defined level wins, and non-positive there
            // means none. The signal is created once here — not inside core() —
            // so a retry sequence draws from a single budget rather than getting
            // a fresh one per attempt. It is resolved once per execute(), not
            // once per api-method call: `result.retry()` re-enters execute()
            // and must draw a FRESH deadline, not the exhausted remains of the
            // first attempt's (tests/timeout.test.ts, "gives retry() a fresh
            // budget").
            //
            // Under `share` this is still this caller's own budget, bounding
            // this caller's own pipeline and nothing else. The shared request
            // has a deadline of its own — the endpoint's, else the client's,
            // measured from when it was sent — which the share step in core()
            // hands to the tracker. A per-call timeout therefore bounds only its
            // caller, and a late joiner cannot extend the shared request.
            //
            // `endpointDeadline` is the deadline inside that budget when it is
            // the endpoint's or the client's — the one a shared request also
            // has — and undefined when a per-call timeout set this caller's own.
            // The share step uses it to tell a give-up to that deadline (one
            // failure, however many callers hit it) from the caller's own.
            const { signal: operation, endpointDeadline } = callBudget(
              options.timeout,
              request.config.timeout,
              clientTimeout,
              options.signal
            )
            own(operation, options.signal)
            const callerSignal: AbortSignal | undefined = operation
            let dedupeController: AbortController | undefined
            // Under share, the last attempt's part in a round trip, for the
            // backstop (Step 8): a call it settles at the endpoint's deadline
            // while still waiting on a shared request is that request's failure
            // too; one whose round trip had answered times out on its own.
            let lastRound: SharedRound | undefined

            // -----------------------------------------------------------------
            // Step 3: Define the core fetch function
            // -----------------------------------------------------------------
            // This is the innermost layer of the onion — the function that
            // actually calls fetch(). Middleware wraps this function; the last
            // middleware in the chain calls next() which invokes this core.
            //
            // The core function receives the (possibly mutated) middleware
            // context and performs one attempt:
            // a. Build the fetch RequestInit (method, headers, signal, body)
            // b. Call fetch with the resolved URL and init, and read the body
            //    once (`sendExchange`, src/utils/exchange.ts) — or, under
            //    share: true, join an identical request already in flight
            // c. Decode that read based on the configured responseType, for
            //    this caller alone
            // d. Return a success or error Result
            //
            // Network errors (fetch throws), and a body read our own signal
            // aborted, are caught and returned as network error Results
            // (status 0, no response).
            //
            // `attempt` is that body. Under share, `core` wraps it so every
            // Result it returns passes through one stamp, below; `round` records
            // whether this attempt took part in a shared round trip, and how.
            // -----------------------------------------------------------------
            const attempt = async (ctx: MiddlewareContext, round: SharedRound): Promise<Result<unknown>> => {
              // Under share, the signal this caller waits on (set in the share
              // step); the catch classifies this caller's give-up by it.
              let waitSignal: AbortSignal | undefined
              try {
                // Register with the dedupe tracker on the first attempt that
                // reaches core() — we are committed to sending a request. Any
                // middleware that short-circuits above us returned without
                // reaching this point, so it cannot cancel a live request.
                //
                // The `!dedupeController` guard makes this once per execute(),
                // not once per attempt. retryMiddleware calls next() repeatedly;
                // if every attempt re-registered, an older request's retry would
                // abort a newer call for the same endpoint — the exact inverse
                // of dedupe's newest-wins contract. Registering once also means
                // a request that has been superseded stays cancelled: its retry
                // reuses the signal the newer call aborted.
                //
                // The signal we hand to track() is ctx.request.signal, not the
                // caller's: a middleware may have installed its own (a timeout,
                // a deadline), and dedupe must merge that rather than discard
                // it. Because registration happens only once, that field still
                // holds a live signal here — never a previous attempt's already
                // aborted dedupe signal.

                if (request.config.dedupe && copy.dedupe && !dedupeController) {
                  const external = ctx.request.signal ?? callerSignal
                  const tracked = dedupeTracker.track(name + copy.lane, external)
                  dedupeController = tracked.controller
                  ctx.request.signal = tracked.signal
                  own(tracked.signal, external)
                  // A supersede is this operation's own cancellation too, so a
                  // call parked in response-side middleware still settles as
                  // 'abort' when a newer call replaces it.
                  backstop.watch(tracked.controller.signal)
                }

                // Build the RequestInit object for the native fetch call.
                // We pull method, headers, and signal from the context (middleware
                // may have modified any of them) rather than closing over a signal
                // computed during setup — that's what lets a middleware replace
                // the signal (e.g. to implement a timeout) and have it actually
                // take effect. The share key below is built from these same
                // values, so it is what fetch receives by construction.
                const sendMethod = ctx.request.method
                const sendUrl = ctx.request.url
                const sendHeaders = ctx.request.headers
                // The fetch options as the middleware left them, without the
                // fields liaise controls; method, headers and signal are set
                // over them, so liaise's own values always win (5.2.0). The share
                // key below takes the same copy, so it is what fetch receives.
                const sendOptions = sendableFetchOptions(ctx.request.fetchOptions)
                const fetchInit: RequestInit = {
                  ...sendOptions,
                  method: sendMethod,
                  headers: sendHeaders,
                  signal: ctx.request.signal
                }

                // Only set the body if there is one — GET/DELETE requests
                // typically have no body, and setting body to null/undefined
                // on those methods may cause issues with some fetch implementations.
                if (ctx.request.body !== null && ctx.request.body !== undefined) {
                  const body = ctx.request.body
                  if (isReadableStream(body)) {
                    if (sentStreams.has(body)) {
                      throw new TypeError(
                        'A ReadableStream body can only be sent once, so retry() and retryMiddleware cannot resend it. ' +
                        'If this call may be retried, read the stream into a Blob or ArrayBuffer first.'
                      )
                    }
                    sentStreams.add(body)
                    // Required by Node's fetch and Chrome for a streaming request body.
                    ;(fetchInit as RequestInit & { duplex: 'half' }).duplex = 'half'
                  }
                  fetchInit.body = body as BodyInit
                }

                // fetch, then the body read, exactly once. A read our own signal
                // aborted throws AbortedRead (classified in the outer catch); any
                // other read failure is recorded on the exchange and rethrown by
                // decodeBody inside the branch's own try below, where it was
                // always handled.
                //
                // Under `share`, join an identical request already in flight —
                // identical meaning what is about to go on the wire (spec §3.2):
                // the final method, URL, headers and body, and the fetch
                // options, built after every middleware, so a header an auth
                // middleware added (the current user) is part of the
                // comparison. Everything before this point ran for this caller
                // alone, and so does everything after it: only the round trip
                // is shared, and each caller decodes its own copy of the one
                // read. A body that can't be compared cheaply and safely (an
                // upload), or fetch options holding a value that isn't a
                // primitive, has no key and is sent as usual.
                const responseType = request.config.responseType ?? 'json'
                const shareKey = request.config.share === true
                  ? requestKey(name, sendMethod, sendUrl, sendHeaders, fetchInit.body ?? null, sendOptions)
                  : null
                let exchange: Exchange
                if (shareKey === null) {
                  exchange = await sendExchange(sendUrl, fetchInit, responseType, clientFetch)
                } else {
                  // This caller's patience: its own budget, plus the signal its
                  // pipeline left in ctx.request.signal when a middleware
                  // replaced it. Either one firing releases this caller alone —
                  // its own cancel still lets go of the round trip even when a
                  // middleware installed a signal that never fires — and the
                  // request is cancelled only once every caller has gone.
                  // (dedupe never combines with share, so no supersede here.)
                  const installed = ctx.request.signal
                  waitSignal = installed === callerSignal ? installed : anySignal([callerSignal, installed])
                  own(waitSignal, callerSignal, installed)
                  const shared = await shareTracker.run(
                    shareKey,
                    // The shared request's own deadline: the endpoint's, else
                    // the client's, measured from when it is sent — so a stream
                    // of late joiners can't hold it open. A per-call timeout
                    // bounds only its own caller, through waitSignal.
                    // Called synchronously, inside this try: timeoutSignalFor
                    // clamps any number, and whatever it throws for a non-number
                    // (a BigInt from untyped config) becomes this caller's Result.
                    () => timeoutSignalFor(undefined, request.config.timeout, clientTimeout),
                    // When it aborts, run() rejects with its reason, classified
                    // in the catch as this caller's own abort or timeout.
                    waitSignal,
                    // Sent with the first caller's init, headers included (so its
                    // tracing headers), and the shared signal: the refcount plus
                    // the deadline above, never any one caller's. If that signal
                    // aborted, the failure is that abort, whatever fetch
                    // rejected with (sendSharedExchange, utils/exchange.ts).
                    signal => sendSharedExchange(sendUrl, { ...fetchInit, signal }, responseType, clientFetch),
                    // Learnt on entry, before this caller can give up, so even
                    // an early give-up knows which round trip it left.
                    entered => {
                      round.token = entered.token
                      round.deadlineToken = entered.deadlineToken
                      round.joined = entered.joined
                    }
                  )
                  // From here on an error is derived from the round trip's
                  // outcome; the catch narrows that for its deadline and for
                  // this caller's own give-up.
                  round.tag = round.token
                  if (!shared.outcome.ok) throw shared.outcome.error
                  exchange = shared.outcome.exchange
                }
                const response = exchange.response

                // ---------------------------------------------------------------
                // Handle non-OK responses (4xx, 5xx)
                // ---------------------------------------------------------------
                // The server responded, but with an error status. We still have
                // the response (headers, body) available for inspection.
                // ---------------------------------------------------------------
                if (!response.ok) {
                  // Decode the error response body using the same responseType
                  // config. If decoding fails (e.g., server returned HTML for a
                  // JSON endpoint), or the read failed for a reason other than
                  // our own signal, fall back to null.
                  //
                  // An abort landing while an ERROR body downloads (a slow
                  // gateway's multi-kilobyte 502 page, say) must not be
                  // misreported as a genuine 'http' error with a null body:
                  // the classification would then be decided by the server's
                  // status code rather than by what actually happened, and the
                  // same user action (navigating away) would read as a real
                  // 5xx to retryOn and to onError. That read never reaches this
                  // catch — `sendExchange` throws it as an AbortedRead, and the
                  // outer catch classifies it by the signal's reason.
                  let body: unknown
                  try {
                    // 'none' describes the success shape only — it means "this
                    // endpoint returns no body when it succeeds", not "never
                    // read a body". An error response is a different shape and
                    // its body is diagnostic (validation messages, error
                    // codes), so a 'none' request still gets its error body
                    // parsed as JSON here, on this non-2xx path only —
                    // `sendExchange` read it as text for exactly that reason.
                    // The success path below is untouched.
                    const errorResponseType =
                      request.config.responseType === 'none' ? 'json' : request.config.responseType
                    body = decodeBody(exchange, errorResponseType)
                    // Normalize the empty-JSON sentinel here too. This is NOT
                    // part of the 4.0.0 seam (the success-path empty-body branch
                    // below is the only place that seam applies) — an error
                    // response with no body is ordinary and stays `null`
                    // forever, in 3.1.0 and in 4.0.0 alike.
                    // Do not "unify" this with the success-path seam: that
                    // path's whole point is a body the caller expected and
                    // didn't get; this one is a body nobody promised. Letting
                    // the module-private sentinel escape into `error.body`
                    // breaks `` `${error.body}` `` for every caller (it throws
                    // TypeError on a symbol) — see tests/empty-body.test.ts.
                    if (body === EMPTY_JSON_BODY) body = null
                  } catch {
                    body = null
                  }

                  const error = new ApiError({
                    status: response.status,
                    kind: 'http',
                    statusText: response.statusText,
                    body,
                    headers: response.headers,
                    request: { method: ctx.request.method, url: ctx.request.url, params }
                  })

                  // retry points to execute() — re-enters the full pipeline
                  return createErrorResult(error, response, retry)
                }

                // ---------------------------------------------------------------
                // Handle successful responses (2xx)
                // ---------------------------------------------------------------
                // Decode in its own try so a malformed body is reported as what
                // it is: the server responded, we could not read it. Falling
                // through to the network catch would report status 0 and
                // discard the Response, telling the caller they are offline
                // when they are not. A read that failed for a reason other than
                // our own signal (a stream that errored, a body that is not the
                // declared FormData) is rethrown by decodeBody and lands here
                // too, as a 'parse' for the same reason.
                //
                // An abort that lands after headers arrive (a component
                // unmounting mid-download) never lands here. That is our own
                // cancellation, not "the server responded but the body was
                // unreadable", and `sendExchange` tells the two apart by
                // provenance: it checks the signal handed to fetch at the
                // moment the read failed, and throws the abort as an
                // AbortedRead. The outer catch below classifies it, with the
                // same response:null/status:0 shape (createNetworkErrorResult)
                // a fetch-time abort gets, and graphql.ts does the same for the
                // identical scenario. Because that decision is made at the
                // read, a body that was read in full and then fails to parse is
                // a 'parse' even if the signal has aborted by now.
                let data: unknown
                try {
                  data = decodeBody(exchange, request.config.responseType)
                } catch (parseErr) {
                  const error = new ApiError({
                    kind: 'parse',
                    status: response.status,
                    statusText: response.statusText,
                    body: parseErr,
                    headers: response.headers,
                    request: { method: ctx.request.method, url: ctx.request.url, params }
                  })
                  return createErrorResult(error, response, retry)
                }

                // An empty body under responseType 'json' is a contradiction:
                // the caller declared JSON and the server sent none, so
                // `data: TResponse` cannot be honoured. 3.1.0 warned and
                // degraded to null; since 4.0.0 it is reported for what it is.
                //
                // Classified 'parse' rather than 'http' because the response
                // itself was fine — a 200 is still a 200. `status` is the
                // response's own (a 204 reports 204, not 0) and the `Response`
                // is kept, matching every other 'parse' error: the server
                // answered, we could not read the answer.
                //
                // `body` is the raw response text. Every other 'parse' error
                // puts the thrown exception there, but nothing threw here —
                // the text is what actually arrived, and for this branch it is
                // always '' (a non-empty text would have been parsed instead).
                //
                // An endpoint that legitimately answers with no body declares
                // responseType: 'none' and never reaches this branch.
                if (data === EMPTY_JSON_BODY) {
                  const error = new ApiError({
                    kind: 'parse',
                    status: response.status,
                    statusText: response.statusText,
                    body: '',
                    headers: response.headers,
                    request: { method: ctx.request.method, url: ctx.request.url, params }
                  })
                  return createErrorResult(error, response, retry)
                }

                // -------------------------------------------------------------
                // Optional schema validation
                // -------------------------------------------------------------
                // Runs after the empty-body check: that check's diagnosis ("the
                // server sent nothing under responseType json") is more specific
                // than "your schema rejected undefined".
                //
                // The try/catch is load-bearing. This statement sits AFTER the
                // parse try/catch has closed, inside the outer handler — the one
                // that reports status 0 with kind 'network', and that checks
                // signal.aborted first. A validator that throws instead of
                // returning issues would otherwise surface as a network failure,
                // or as a cancellation that never happened, on a request that
                // completed successfully.
                // -------------------------------------------------------------
                if (request.config.schema) {
                  let outcome: SchemaOutcome
                  try {
                    outcome = await runSchema(request.config.schema, data)
                  } catch (validatorErr) {
                    const error = new ApiError({
                      kind: 'parse',
                      status: response.status,
                      statusText: response.statusText,
                      body: validatorErr,
                      headers: response.headers,
                      request: { method: ctx.request.method, url: ctx.request.url, params }
                    })
                    return createErrorResult(error, response, retry)
                  }

                  if (!outcome.ok) {
                    const error = new ApiError({
                      kind: 'parse',
                      status: response.status,
                      statusText: response.statusText,
                      body: outcome.issues,
                      headers: response.headers,
                      request: { method: ctx.request.method, url: ctx.request.url, params }
                    })
                    return createErrorResult(error, response, retry)
                  }

                  // `data` becomes the schema's OUTPUT — transforms, coercions and
                  // defaults apply. See `schema` on RequestConfig.
                  data = outcome.value
                }

                return createSuccessResult(data, response, retry)
              } catch (err) {
                // ---------------------------------------------------------------
                // Handle network errors (fetch threw)
                // ---------------------------------------------------------------
                // This catches DNS failures, CORS errors, abort signals, offline
                // scenarios, and any other case where fetch itself throws instead
                // of returning a Response.
                //
                // Status 0 is the convention for "no HTTP response" — the error
                // body contains the native Error (TypeError for network, or
                // DOMException for abort) for debugging.
                //
                // Provenance over name-sniffing: if the signal we actually
                // handed to fetch is the one that's aborted, this failure IS
                // that cancellation — whatever `fetch` threw, including a
                // custom, non-`AbortError`-named reason a caller passed to
                // `ac.abort(reason)`. Only fall back to sniffing `err`'s own
                // shape when our signal is not the cause, for a genuine
                // network failure.
                //
                // An abort during the body read arrives as AbortedRead: its
                // `reason` classifies it, its `cause` (what the read threw) is
                // the body, as before. It is our abort unconditionally —
                // `sendExchange` already established that on the signal handed
                // to fetch — so it is not re-checked against ctx.request.signal,
                // which a middleware could have reassigned while core awaited.
                // Under share the signal handed to fetch is the shared request's,
                // not this caller's, so the share step reports ITS aborts (at
                // fetch time too) the same way.
                //
                // Under share, this caller giving up arrives here as the reason
                // of the signal it waited on (ShareTracker.run rejects with it),
                // and the `ownGiveUp` arm classifies it by THAT signal — the one
                // that aborted, which may be the caller's own while a middleware
                // left a different one in ctx.request.signal — exactly as it
                // classifies an unshared caller's cancel.
                // ---------------------------------------------------------------
                const aborted = err instanceof AbortedRead
                const signal = waitSignal ?? ctx.request.signal
                const ownGiveUp = !aborted && signal?.aborted === true
                const kind = aborted
                  ? (abortKind(err.reason) ?? 'abort')
                  : ownGiveUp
                    ? (abortKind(signal.reason) ?? 'abort')
                    : (abortKind(err) ?? 'network')
                // Which of the round trip's identities this error carries, if
                // any (core's stamp, below; nothing is set for an unshared
                // call): the shared request's own abort is its deadline, and
                // this caller's own give-up is its own failure unless it gave
                // up to that same deadline. The rule, for both clients, is
                // narrowTag's (utils/share.ts).
                narrowTag(round, aborted, ownGiveUp ? signal : undefined, endpointDeadline)
                const error = new ApiError({
                  status: 0,
                  kind,
                  statusText: '',
                  body: aborted ? err.cause : err,
                  headers: new Headers(),
                  request: { method: ctx.request.method, url: ctx.request.url, params }
                })

                return createNetworkErrorResult(error, retry)
              }
            }

            // Only a share: true endpoint pays for the stamp's extra await; every
            // other call's core is `attempt` itself, with the same microtask
            // count it always had (tests/hung-middleware.test.ts, "the
            // microtask count from an answer to onError", pins it).
            const core: (ctx: MiddlewareContext) => Promise<Result<unknown>> = request.config.share === true
              ? async ctx => {
                const round: SharedRound = { joined: false }
                lastRound = round
                // An error derived from the shared round trip carries one of its
                // tokens, so onError hears about one failed shared request once;
                // a Result that joined is marked for the logger (stampShared,
                // utils/share.ts, holds the rule for both clients).
                return stampShared(await attempt(ctx, round), round)
              }
              : ctx => attempt(ctx, { joined: false })

            // -----------------------------------------------------------------
            // Step 4: Build the URL
            // -----------------------------------------------------------------
            // buildUrl handles three things:
            // a. Substitutes :param tokens in the path with matching param values
            // b. Appends remaining params as query string (when asQuery is true)
            // c. Returns the remaining (unconsumed) params for body serialization
            //
            // All of it lives in `resolveRequestUrl` rather than here, because
            // the error paths call the same function to name `error.request.url`
            // — see its doc for why that matters.
            // -----------------------------------------------------------------
            const { url, remaining, asQuery, whole } = resolveRequestUrl(baseUrl, request, params)

            // -----------------------------------------------------------------
            // Step 5: Merge headers from all three layers
            // -----------------------------------------------------------------
            // The merge order determines precedence: later sources override earlier.
            // copy layers (client, then each withHeaders copy) → per-request → per-call (highest)
            // -----------------------------------------------------------------
            const headers = mergeHeaders(...copy.headers, request.config.headers, options.headers)
            // The fetch options merge the same way, field by field (5.2.0), into
            // a fresh object, so a middleware changing ctx.request.fetchOptions
            // never reaches the configuration or the next call.
            const fetchOptions = mergeFetchOptions(clientFetchOptions, request.config.fetchOptions, options.fetchOptions)

            // -----------------------------------------------------------------
            // Step 6: Serialize the body (for non-query requests)
            // -----------------------------------------------------------------
            // For GET/DELETE (asQuery=true), all params went into the query string
            // via buildUrl, so there's no body to serialize.
            //
            // For POST/PUT/PATCH (asQuery=false), the remaining params (those not
            // consumed by path param substitution) become the request body.
            //
            // Special body types (FormData, Blob, etc.) bypass the remaining-params
            // logic and are passed directly to serializeBody, which handles them
            // with appropriate Content-Type detection.
            // -----------------------------------------------------------------
            let body: unknown | null = null
            if (!asQuery) {
              // Decide what to serialize: the original params (for special types)
              // or the remaining params after path substitution (for plain objects)
              const toSerialize = whole ? whole.value : remaining

              // Only serialize if there's something to serialize — avoid sending
              // empty bodies ({}) for endpoints with no body params.
              if (whole || Object.keys(remaining).length > 0) {
                const serialized = serializeBody(toSerialize)
                body = serialized.body

                // Auto-set Content-Type if serializeBody determined one AND the
                // caller hasn't explicitly set one (per-call or per-request headers
                // should be able to override the auto-detected type).
                // Note: For FormData, contentType is null because the browser needs
                // to set the multipart boundary automatically.
                if (serialized.contentType && !headers.has('Content-Type')) {
                  headers.set('Content-Type', serialized.contentType)
                }
              }
            }

            // -----------------------------------------------------------------
            // Step 7: Build the middleware context
            // -----------------------------------------------------------------
            // The context object is what every middleware receives. It contains
            // all information about the request: method, URL, original path,
            // params, headers, and serialized body. Middleware can read and
            // modify headers and body before the fetch executes.
            // -----------------------------------------------------------------
            const context: MiddlewareContext = {
              request: {
                method: request.config.method,
                url,
                path: request.config.path,
                params,
                headers,
                body,
                fetchOptions,
                signal: callerSignal
              },
              requestName: name
            }
            stampClientFetch(context, clientFetch)

            // -----------------------------------------------------------------
            // Step 8: Compose middleware and execute
            // -----------------------------------------------------------------
            // composeMiddleware creates the onion chain: each middleware wraps
            // the next, with the core fetch function at the center.
            // skipMiddleware filters out specific middleware by reference (===).
            //
            // The backstop is what makes `timeout` and `options.signal` bound
            // the whole chain, not only the part that reaches fetch: a
            // middleware awaiting something the signal does not reach (a
            // stalled token refresh) can no longer hold the call past its own
            // deadline. It watches this call's own signal — the deadline and
            // the caller's signal (and, under dedupe, the supersede) — and, once
            // it aborts, gives the chain one macrotask to answer before
            // settling with the abort Result itself. See utils/backstop.ts for
            // why the grace period exists. `guard` stops a middleware that
            // resumes after that from sending a request nobody is waiting on.
            //
            // Under share, a caller waiting on a shared round trip is waiting
            // inside core(), on its own signal, like any other — but the Result
            // the backstop builds goes through the same rule as one core built
            // (stampPreempted, utils/share.ts). Without it, a hung shared
            // request reported once per caller whenever a response-side
            // middleware awaited a macrotask after next(): the backstop beat
            // that middleware to every caller with an untagged timeout.
            // -----------------------------------------------------------------
            const backstop = createBackstop<Result<unknown>>(signal =>
              stampPreempted(
                buildFailedResult(signal.reason, signal, 'abort', context.request.url),
                lastRound,
                signal,
                endpointDeadline
              )
            )
            backstop.watch(callerSignal)
            const composed = composeMiddleware(allMiddleware, backstop.guard(core), options.skipMiddleware ?? [])
            // The client's `log`: the start line now, before any middleware
            // runs, and the end line from the post-execution hook below — after
            // the backstop, not inside it as a middleware would be, so a call
            // the backstop settles still logs its end, at its deadline, once.
            const logEnd = logger?.(context)
            // composeMiddleware has no guard of its own, and execute()'s try/catch
            // only covers the synchronous setup above — so an async middleware
            // that throws escapes as a rejection and breaks the library's one
            // headline guarantee. Convert it here, before the post-execution
            // hook, so the failure reaches onError like any other.
            //
            // A middleware that throws SYNCHRONOUSLY (a plain, non-async
            // function) never gets as far as handing back a promise for
            // `.catch` to attach to — composed(context) itself throws, before
            // this statement finishes evaluating. The surrounding try/catch
            // below already turns that into a Result, but with fallback kind
            // 'network' — correct for a setup error (e.g. buildUrl's
            // TypeError), wrong for a throwing middleware. Catching it here
            // too, right alongside the async case, keeps both classified as
            // 'middleware' and routed through the same post-execution hook.
            let resultPromise: Promise<Result<unknown>>
            try {
              resultPromise = composed(context).catch(
                (err: unknown) => buildFailedResult(err, context.request.signal, 'middleware', context.request.url)
              )
            } catch (err) {
              resultPromise = Promise.resolve(
                buildFailedResult(err, context.request.signal, 'middleware', context.request.url)
              )
            }

            // -----------------------------------------------------------------
            // Step 9: Post-execution hooks (log end line, dedupe cleanup, release, onError)
            // -----------------------------------------------------------------
            // After the middleware chain completes (with any result) — or the
            // backstop settles on its behalf — we run this exactly once:
            // a. Print the `log` end line, with the final Result
            // b. Clear the dedupe tracker for this endpoint (if dedupe is enabled)
            //    so the next call starts fresh without aborting a completed request
            // c. Release this run's merged signals (releaseAll above) — always,
            //    whether or not dedupe is on
            // d. Fire the onError callback if the final result has an error
            //    (only fires on final error — if retry middleware recovered, no fire)
            // -----------------------------------------------------------------
            return backstop.follow(resultPromise, (result, preempted) => {
              // First, so the end line comes before anything onError prints.
              logEnd?.(result)

              // Clean up dedupe tracking after the request completes.
              // This must happen before onError so that onError handlers can
              // immediately fire a new request without triggering a dedupe abort.
              //
              // dedupeController is only assigned inside core() — if every
              // middleware short-circuited and core() never ran (e.g. a cache
              // hit), it stays undefined here. clear() with no controller
              // deletes the map entry unconditionally, which would be wrong in
              // that case: it could delete the entry belonging to a genuinely
              // in-flight request registered by someone else under the same
              // name. So only clear when this execute() actually registered.
              //
              // When the backstop won, this call's request may still be in
              // flight under a signal some middleware installed. Dropping the
              // entry without aborting would leave nothing able to cancel it —
              // a newer call's track() finds no entry to supersede — so abort
              // it first: nobody is waiting on it.
              if (request.config.dedupe && dedupeController) {
                if (preempted) dedupeController.abort()
                dedupeTracker.clear(name + copy.lane, dedupeController)
              }

              // The operation is over on whichever side won, so its merges can
              // let go of their inputs. Before onError, so a handler that
              // aborts the caller's signal finds nothing of ours on it.
              releaseAll()

              // Fire the global error handler if the final result has an error.
              // This is the "last chance" error hook — middleware has already had
              // its opportunity to handle/recover the error. Guarded: a throwing
              // handler must not reject a promise that already holds a Result.
              //
              // One failed shared request reports once, whichever of its callers
              // gets here first: every caller's error derived from that round
              // trip carries the same token (see core), and
              // ShareTracker.shouldReport lets one token through once. Anything
              // else — an unshared call, a caller's own give-up, an error a
              // middleware produced — is untagged and reports as always. A
              // round trip whose callers have all given up reaches nobody's
              // pipeline at all, so its own failure is never seen here.
              if (result.error && shareTracker.shouldReport(result.error)) fireOnError(result.error as ApiError)

              return result
            }, (err: unknown) => {
              // Only reachable with a signal-shaped value whose `reason` throws —
              // a fake `CallOptions.signal` from plain JS — so the backstop could
              // not build its Result. Never throws holds regardless. This is the
              // call's final Result too, so it gets the end line (a no-op if the
              // hook above printed one before something in it threw).
              releaseAll()
              const result = buildFailedResult(err, undefined, 'abort')
              logEnd?.(result)
              fireOnError(result.error as ApiError)
              return result
            })
          } catch (err) {
            // -----------------------------------------------------------------
            // Catch synchronous errors
            // -----------------------------------------------------------------
            // This catches errors thrown synchronously during the request setup
            // phase (before the async middleware chain starts). The most common
            // case is TypeError from buildUrl when a nested object is passed
            // as a query string parameter.
            //
            // By catching here and returning a Result, we maintain the "never
            // throws" contract — callers always get a Result, never an
            // unhandled rejection.
            // -----------------------------------------------------------------
            // Fire onError for synchronous errors too — they're still errors.
            // `undefined`, not `callerSignal`, is passed here for two reasons:
            // (a) `callerSignal` is a `const` scoped inside the `try` above and
            // is simply unreachable from this `catch` block; and (b), the
            // reason that matters — this is a deliberate policy, not a
            // limitation to route around by hoisting it into scope. A bug in
            // request *setup* (buildUrl's TypeError, a BigInt timeout reaching
            // Math.min) must always report as the setup bug it is, even when
            // the caller has ALSO aborted around the same time — silently
            // reclassifying a real setup failure as 'abort' just because a
            // signal happens to be aborted would hide it from onError.
            // Setup may have merged signals before it threw; nothing will
            // settle this run later, so release them now.
            releaseAll()
            return Promise.resolve(failedResult(err, undefined, 'network'))
          }
        }

        /**
         * What every Result hands consumers as `retry`: this caller's own
         * pipeline again, with this caller's own options — under `share` too,
         * where it may share again with whatever identical request is then in
         * flight. Kept apart from `execute` on purpose: `retry` is passed
         * around as a bare function (`[r].map(r.retry)` supplies
         * `(value, index)`, `retry({})` an object), and an internal parameter
         * on `execute` once received those values and silently dropped the
         * caller's signal and timeout. Zero parameters here keeps any future
         * one out of reach.
         */
        function retry(): Promise<Result<unknown>> {
          return execute()
        }

        return execute()
      }

      // Configuration-only headers (no per-call layer): a fresh record each call,
      // so a caller mutating it cannot reach the next caller.
      // An invalid configured header (a non-Latin-1 value, a name with a space)
      // makes `new Headers()` throw, and a public entry point never throws: {}.
      ;(api[name] as Function & EndpointExtras).getHeaders = () => {
        try {
          return headersRecord(mergeHeaders(...copy.headers, request.config.headers))
        } catch {
          return {}
        }
      }

      // A copy's endpoint names the original's, so poll.ts can share one loop
      // between copies that send the same thing. The original's carry no stamp.
      if (origin) stampPollId(api[name], origin[name], pollKeyOf(copy))
    }

    stampCopier(api, (headers, options) => build(nextCopy(copy, headers, options), origin ?? api))
    return api
  }

  // Cast the dynamically-built object to the fully-typed Api type.
  // The types are correct because each generated method's params/response
  // match the Request's generics — the cast is safe.
  return build(originalState(globalHeaders), null) as Api<TRequests>
}
