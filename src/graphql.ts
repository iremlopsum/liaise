import { ApiError, createSuccessResult, createErrorResult, createNetworkErrorResult } from './result.js'
import { composeMiddleware } from './middleware.js'
import { DedupeTracker } from './utils/dedupe.js'
import { callLoggerFor } from './utils/log.js'
import { ShareTracker, requestKey, narrowTag, stampShared, stampPreempted } from './utils/share.js'
import type { SharedRound } from './utils/share.js'
import { mergeHeaders, headersRecord } from './utils/headers.js'
import { abortKind, propagatesReason } from './utils/abort-kind.js'
import { callBudget } from './utils/budget.js'
import { anySignal, releaseSignal } from './utils/any-signal.js'
import { timeoutSignalFor } from './utils/timeout.js'
import { createBackstop } from './utils/backstop.js'
import { runSchema } from './utils/validate.js'
import type { SchemaOutcome } from './utils/validate.js'
import { sendExchange, sendSharedExchange, AbortedRead } from './utils/exchange.js'
import type { Exchange } from './utils/exchange.js'
import type { CallOptions, EndpointExtras, ErrorResult, Middleware, MiddlewareContext, Result, GraphQLBaseConfig, OperationConfig, GraphQLError } from './types.js'

// ---------------------------------------------------------------------------
// Operation — typed config container for GraphQL operations
// ---------------------------------------------------------------------------

export class Operation<TVariables extends object, TData> {
  readonly config: OperationConfig
  // phantom fields — never assigned; exist only so TypeScript can infer TVariables/TData
  // from conditional types in createGraphQL (e.g. `T extends Operation<infer V, infer D>`)
  declare readonly _variables: TVariables
  declare readonly _data: TData
  constructor(config: OperationConfig) {
    this.config = config
  }
}

// ---------------------------------------------------------------------------
// gql — tagged template literal for editor tooling support
// ---------------------------------------------------------------------------

export const gql = (strings: TemplateStringsArray, ...values: unknown[]): string =>
  String.raw({ raw: strings }, ...values)

// ---------------------------------------------------------------------------
// Internal type helpers
// ---------------------------------------------------------------------------

type GraphQLMethod<TVariables extends object, TData> =
  (Record<string, never> extends TVariables
    ? (variables?: TVariables, options?: CallOptions) => Promise<Result<TData>>
    : (variables: TVariables, options?: CallOptions) => Promise<Result<TData>>) & EndpointExtras

type FlatClient<TOperations> = {
  [K in keyof TOperations]: TOperations[K] extends Operation<infer V, infer D>
    ? GraphQLMethod<V, D>
    : never
}

type SplitClient<TQ, TM> =
  (TQ extends Record<string, Operation<any, any>> ? { query: FlatClient<TQ> } : {}) &
  (TM extends Record<string, Operation<any, any>> ? { mutation: FlatClient<TM> } : {})

type WithOperations<T> = GraphQLBaseConfig & {
  operations: T
  queries?: never
  mutations?: never
}

type WithSplit<TQ, TM> = GraphQLBaseConfig & {
  operations?: never
  queries?: TQ
  mutations?: TM
}

// ---------------------------------------------------------------------------
// createGraphQL — overloaded factory
// ---------------------------------------------------------------------------

export function createGraphQL<T extends Record<string, Operation<any, any>>>(
  config: WithOperations<T>
): FlatClient<T>
export function createGraphQL<
  TQ extends Record<string, Operation<any, any>>,
  TM extends Record<string, Operation<any, any>>
>(config: WithSplit<TQ, TM>): SplitClient<TQ, TM>
export function createGraphQL(config: any): any {
  const {
    endpoint,
    middleware: globalMiddleware = [],
    headers: globalHeaders,
    onError,
    timeout: clientTimeout,
  } = config
  // Not a middleware: it wraps each whole call, ending in the post-execution
  // hook — see the same line in create-api.ts. Null when off.
  const logger = callLoggerFor(config.log)

  const dedupeTracker = new DedupeTracker()

  // Under share: true, core() joins an identical operation already in flight
  // instead of sending its own (see the share step in core). One tracker per
  // client, like dedupeTracker. share and dedupe are opposites, so an
  // operation that sets both is refused when the client is built, below — the
  // one sanctioned throw outside a Result, as in createApi.
  const shareTracker = new ShareTracker()

  /**
   * Calls the consumer's `onError`, swallowing anything it throws.
   *
   * `onError` runs *after* the result is in hand, so an exception from it
   * would reject a promise that already holds a perfectly good `Result` — the
   * caller would see a throw for an operation that merely came back with
   * GraphQL errors. A Sentry client in a misconfigured environment, or a
   * logger dereferencing `error.response.status`, is all it takes. Same stance
   * as the retry policy's user callbacks in `built-in-middleware.ts`.
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
      /* swallowed by contract — onError cannot fail an operation */
    }
  }

  function buildMethod(name: string, operation: Operation<any, any>) {
    const method = (variables: object = {}, options: CallOptions = {}): Promise<Result<unknown>> => {
      const execute = (): Promise<Result<unknown>> => {
        /**
         * `create-api.ts`'s local equivalent, for the same reason: a Result
         * for a failure that never reached (or never came back from) `core()`,
         * construction only, no reporting — the `.then` hook below is what
         * reports, once, so this must not report a second time.
         *
         * Classification is by provenance, not by sniffing `reason`'s shape —
         * see `syntheticResult`'s doc in `create-api.ts` for the full
         * rationale. In short: if `signal` — the AbortSignal that actually
         * governs this operation — is the one that aborted, this failure IS
         * that cancellation, whatever shape `reason` takes. Two fallbacks
         * reach it. `'middleware'`, for a rejection escaping the chain, gets
         * the propagation check (`propagatesReason` — identity, or one level
         * of `.cause`): a middleware throwing its own `AbortError`-named
         * failure, unrelated to this operation's own signal, must stay
         * `'middleware'`. `'abort'`, from the backstop, is always called with
         * the signal that aborted, so it classifies by that signal's reason.
         */
        function buildFailedResult(
          reason: unknown,
          signal: AbortSignal | undefined,
          fallbackKind: 'abort' | 'network' | 'middleware'
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
            request: { method: 'POST', url: endpoint, params: variables },
          })
          return createNetworkErrorResult(error, execute)
        }

        // Every merged signal this run creates, released once it has a
        // Result. `own` skips a signal that is one of its own inputs, which
        // may be a merge another call owns — see the same trio in
        // create-api.ts's execute().
        const merged: AbortSignal[] = []
        const own = (signal: AbortSignal | undefined, ...inputs: (AbortSignal | undefined)[]): void => {
          if (signal && !inputs.includes(signal)) merged.push(signal)
        }
        const releaseAll = (): void => { for (const s of merged) releaseSignal(s) }
        try {
          // The client's `log` is not in this list: it wraps the whole call
          // (below, around the chain and in the post-execution hook).
          const allMiddleware: Middleware[] = [
            ...globalMiddleware,
            ...(operation.config.middleware ?? []),
            ...(options.middleware ?? []),
          ]

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
          // Resolve the deadline: per-call, then per-operation, then the
          // client's — the first defined level wins, and non-positive there
          // means none. The signal is created once here — not inside core() —
          // so a retry sequence draws from a single budget rather than getting
          // a fresh one per attempt.
          //
          // Under `share` this is still this caller's own budget; the shared
          // request has a deadline of its own, which the share step in core()
          // hands to the tracker. `endpointDeadline` is the deadline inside
          // this budget when it is the operation's or the client's — the one
          // a shared request also has — and undefined when a per-call timeout
          // set this caller's own. See the same step in create-api.ts.
          const { signal: callerSignal, endpointDeadline } = callBudget(
            options.timeout,
            operation.config.timeout,
            clientTimeout,
            options.signal
          )
          own(callerSignal, options.signal)
          let dedupeController: AbortController | undefined
          // Under share, the last attempt's part in a round trip, for the
          // backstop below — see the same variable in create-api.ts.
          let lastRound: SharedRound | undefined

          // One attempt: the innermost layer of the onion. Under share,
          // `core` (below) wraps it so every Result it returns passes through
          // one stamp; `round` records whether this attempt took part in a
          // shared round trip, and how.
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
              // if every attempt re-registered, an older operation's retry
              // would abort a newer call for the same operation — the exact
              // inverse of dedupe's newest-wins contract.
              //
              // The signal we hand to track() is ctx.request.signal, not the
              // caller's: a middleware may have installed its own (a timeout,
              // a deadline), and dedupe must merge that rather than discard
              // it. Because registration happens only once, that field still
              // holds a live signal here — never a previous attempt's already
              // aborted dedupe signal.
              if (operation.config.dedupe && !dedupeController) {
                const external = ctx.request.signal ?? callerSignal
                const tracked = dedupeTracker.track(name, external)
                dedupeController = tracked.controller
                ctx.request.signal = tracked.signal
                own(tracked.signal, external)
                // A supersede is this operation's own cancellation too — see
                // the backstop below.
                backstop.watch(tracked.controller.signal)
              }

              // What fetch receives, read from the context at call time so a
              // middleware's changes (headers, body, a replaced signal) take
              // effect. The share key below is built from these same values,
              // so it is what fetch receives by construction.
              const sendUrl = ctx.request.url
              const sendHeaders = ctx.request.headers
              const fetchInit: RequestInit = {
                method: 'POST',
                headers: sendHeaders,
                body: ctx.request.body as string,
                signal: ctx.request.signal,
              }

              // fetch, then the body read, exactly once, as text — the same
              // helper create-api.ts uses. A read our own signal aborted
              // throws AbortedRead, classified in the outer catch below; any
              // other read failure is recorded on the exchange and rethrown
              // at the point each branch below used to do its own read.
              //
              // Under `share`, join an identical operation already in flight
              // — the same step as create-api.ts's, on what is about to go on
              // the wire: always POST, the final endpoint URL, the final
              // headers (an auth middleware's header is part of the
              // comparison) and the body, query and variables exactly as
              // serialised, so variables in a different key order do not
              // share. Everything before this point ran for this caller alone,
              // and so does everything after it: each caller parses its own
              // copy of the one read. A body a middleware replaced with one
              // that can't be compared has no key and is sent as usual.
              const shareKey = operation.config.share === true
                ? requestKey(name, 'POST', sendUrl, sendHeaders, fetchInit.body ?? null)
                : null
              let exchange: Exchange
              if (shareKey === null) {
                exchange = await sendExchange(sendUrl, fetchInit, 'text')
              } else {
                // This caller's patience: its own budget, plus the signal its
                // pipeline left in ctx.request.signal when a middleware
                // replaced it. Either one firing releases this caller alone,
                // and the request is cancelled only once every caller has
                // gone. (dedupe never combines with share, so no supersede.)
                const installed = ctx.request.signal
                waitSignal = installed === callerSignal ? installed : anySignal([callerSignal, installed])
                own(waitSignal, callerSignal, installed)
                const shared = await shareTracker.run(
                  shareKey,
                  // The shared request's own deadline: the operation's, else
                  // the client's, measured from when it is sent — so a stream
                  // of late joiners can't hold it open. A per-call timeout
                  // bounds only its own caller, through waitSignal. Called
                  // synchronously, inside this try, so whatever it throws for
                  // a non-number becomes this caller's Result.
                  () => timeoutSignalFor(undefined, operation.config.timeout, clientTimeout),
                  // When it aborts, run() rejects with its reason, classified
                  // in the catch as this caller's own abort or timeout.
                  waitSignal,
                  // Sent with the first caller's init and the shared signal,
                  // never any one caller's; that signal's abort is that abort,
                  // whatever fetch rejected with (sendSharedExchange).
                  signal => sendSharedExchange(sendUrl, { ...fetchInit, signal }, 'text'),
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

              if (!response.ok) {
                // An abort landing while an ERROR body downloads must not be
                // misreported as a genuine 'http' error with a null body —
                // the classification would otherwise be decided by the
                // server's status code rather than by what actually happened.
                // That read never reaches the catch below: `sendExchange`
                // throws it as an AbortedRead, and the outer `catch (err)`
                // classifies it by the signal's reason, exactly as it does
                // for an abort during the fetch() call itself. The full
                // rationale is written up in create-api.ts, on its
                // success-path decode (the comment beginning "Decode in its
                // own try"); it is not repeated per call site in this file.
                // A read that failed for any other reason, or a body that is
                // not JSON, is diagnostic only and falls back to null.
                let body: unknown
                try {
                  if (exchange.readFailed) throw exchange.readError
                  const text = exchange.body as string
                  body = text ? JSON.parse(text) : null
                } catch {
                  body = null
                }
                const error = new ApiError({
                  status: response.status,
                  kind: 'http',
                  statusText: response.statusText,
                  body,
                  headers: response.headers,
                  request: { method: 'POST', url: ctx.request.url, params: variables },
                })
                return createErrorResult(error, response, execute)
              }

              // Parse in its own try so a malformed body is reported as what it
              // is: the server responded, we could not read it. Falling through
              // to the network catch would report status 0 and discard the
              // Response, telling the caller they are offline when they are not.
              //
              // A failed read is rethrown OUTSIDE that try, deliberately, so a
              // body stream that breaks mid-download reaches the outer
              // `catch (err)` as status 0, kind 'network' — unlike
              // create-api.ts, which rethrows the same failure inside its
              // decode try and reports it as 'parse'. An abort during the
              // read never gets this far: it is an AbortedRead from
              // `sendExchange`, also classified in the outer catch; "abort
              // during a success-body download" in
              // tests/create-graphql.test.ts pins that case.
              if (exchange.readFailed) throw exchange.readError
              const text = exchange.body as string
              let gqlBody: { data?: unknown; errors?: GraphQLError[] } | null
              try {
                gqlBody = text
                  ? (JSON.parse(text) as { data?: unknown; errors?: GraphQLError[] })
                  : null
              } catch (parseErr) {
                const error = new ApiError({
                  kind: 'parse',
                  status: response.status,
                  statusText: response.statusText,
                  body: parseErr,
                  headers: response.headers,
                  request: { method: 'POST', url: ctx.request.url, params: variables },
                })
                return createErrorResult(error, response, execute)
              }

              if (gqlBody?.errors?.length) {
                const error = new ApiError({
                  // The response's own status, not a hardcoded 200: a GraphQL
                  // error can arrive on any 2xx, and every other ApiError in
                  // both clients reports what the server actually sent.
                  status: response.status,
                  kind: 'http',
                  statusText: 'GraphQL Error',
                  body: gqlBody.errors,
                  headers: response.headers,
                  request: { method: 'POST', url: ctx.request.url, params: variables },
                  partialData: gqlBody.data ?? undefined,
                })
                return createErrorResult(error, response, execute)
              }

              // A GraphQL success must carry data. `?? null` used to paper
              // over two different protocol violations here — an empty body
              // (gqlBody is null), and a well-formed {} or {"data": null}
              // with no errors — both surfacing as a success with data: null
              // behind a non-null TData. Since 4.0.0 both are reported.
              //
              // `"data": null` IS legitimate for a field error, but only
              // alongside `errors`, and the branch directly above already
              // routes that to an error Result carrying partialData. Control
              // only reaches here when the server reported no errors at all.
              //
              // Optional chaining also catches a non-object root (`42`,
              // `null`, `[1,2]` — all valid JSON): the GraphQL over HTTP spec
              // requires a map, so those are violations too.
              //
              // error.body is the raw response text, not a thrown exception —
              // nothing threw. It is the only useful answer to "then what did
              // the server send?".
              if (gqlBody?.data == null) {
                const error = new ApiError({
                  kind: 'parse',
                  status: response.status,
                  statusText: response.statusText,
                  body: text,
                  headers: response.headers,
                  request: { method: 'POST', url: ctx.request.url, params: variables },
                })
                return createErrorResult(error, response, execute)
              }

              // -------------------------------------------------------------
              // Optional schema validation
              // -------------------------------------------------------------
              // The REST pipeline carries the same block. The two clients are
              // parallel implementations, so this is duplicated on purpose:
              // there is no shared seam, and a change made to one is not made
              // to the other.
              //
              // The try/catch is load-bearing. This statement sits AFTER the
              // parse try/catch has closed, inside the outer handler — the one
              // that reports status 0 with kind 'network', and that checks
              // signal.aborted first. A validator that throws instead of
              // returning issues would otherwise surface as a network failure,
              // or as a cancellation that never happened, on a request that
              // completed successfully.
              // -------------------------------------------------------------
              if (operation.config.schema) {
                let outcome: SchemaOutcome
                try {
                  outcome = await runSchema(operation.config.schema, gqlBody.data)
                } catch (validatorErr) {
                  const error = new ApiError({
                    kind: 'parse',
                    status: response.status,
                    statusText: response.statusText,
                    body: validatorErr,
                    headers: response.headers,
                    request: { method: 'POST', url: ctx.request.url, params: variables }
                  })
                  return createErrorResult(error, response, execute)
                }

                if (!outcome.ok) {
                  const error = new ApiError({
                    kind: 'parse',
                    status: response.status,
                    statusText: response.statusText,
                    body: outcome.issues,
                    headers: response.headers,
                    request: { method: 'POST', url: ctx.request.url, params: variables }
                  })
                  return createErrorResult(error, response, execute)
                }

                return createSuccessResult(outcome.value, response, execute)
              }

              return createSuccessResult(gqlBody.data, response, execute)
            } catch (err) {
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
              // Under share the signal handed to fetch is the shared
              // request's, and the share step reports ITS aborts (at fetch
              // time too) the same way.
              //
              // Under share, this caller giving up arrives here as the reason
              // of the signal it waited on (ShareTracker.run rejects with it),
              // and the `ownGiveUp` arm classifies it by THAT signal — exactly
              // as it classifies an unshared caller's cancel.
              const aborted = err instanceof AbortedRead
              const signal = waitSignal ?? ctx.request.signal
              const ownGiveUp = !aborted && signal?.aborted === true
              const kind = aborted
                ? (abortKind(err.reason) ?? 'abort')
                : ownGiveUp
                  ? (abortKind(signal.reason) ?? 'abort')
                  : (abortKind(err) ?? 'network')
              // Which of the round trip's identities this error carries, if
              // any — narrowTag's rule (utils/share.ts), as in create-api.ts.
              narrowTag(round, aborted, ownGiveUp ? signal : undefined, endpointDeadline)
              const error = new ApiError({
                status: 0,
                kind,
                statusText: '',
                body: aborted ? err.cause : err,
                headers: new Headers(),
                request: { method: 'POST', url: ctx.request.url, params: variables },
              })
              return createNetworkErrorResult(error, execute)
            }
          }

          // Only a share: true operation pays for the stamp's extra await;
          // every other operation's core is `attempt` itself, with the
          // microtask count it always had (tests/hung-middleware.test.ts,
          // "the microtask count from an answer to onError", pins it).
          const core: (ctx: MiddlewareContext) => Promise<Result<unknown>> = operation.config.share === true
            ? async ctx => {
              const round: SharedRound = { joined: false }
              lastRound = round
              // An error derived from the shared round trip carries one of its
              // tokens, so onError hears about one failed shared operation
              // once; a Result that joined is marked (stampShared).
              return stampShared(await attempt(ctx, round), round)
            }
            : ctx => attempt(ctx, { joined: false })

          const headers = mergeHeaders(globalHeaders, operation.config.headers, options.headers)
          if (!headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json')
          }

          const body = JSON.stringify({ query: operation.config.operation, variables })

          const context: MiddlewareContext = {
            request: {
              method: 'POST',
              url: endpoint,
              path: endpoint,
              params: variables,
              headers,
              body,
              signal: callerSignal,
            },
            requestName: name,
          }

          // The backstop bounds the whole chain by the operation's own signal,
          // not only the part that reaches fetch — the same one create-api.ts
          // uses, and for the same reason: a middleware awaiting something
          // the signal does not reach (a stalled token refresh) must not hold
          // the call past its deadline. See utils/backstop.ts, and the
          // matching block in create-api.ts's execute(). Under share its
          // Result is stamped by the same rule as core's (stampPreempted), so
          // a hung shared operation reports once even when a response-side
          // middleware outlives the grace period.
          const backstop = createBackstop<Result<unknown>>(signal =>
            stampPreempted(buildFailedResult(signal.reason, signal, 'abort'), lastRound, signal, endpointDeadline)
          )
          backstop.watch(callerSignal)
          const composed = composeMiddleware(allMiddleware, backstop.guard(core), options.skipMiddleware ?? [])
          // The client's `log`: the start line now, before any middleware
          // runs, and the end line from the post-execution hook below, after
          // the backstop — see create-api.ts.
          const logEnd = logger?.(context)
          // Same guard as create-api.ts's execute(), and for the same reason:
          // composeMiddleware has no guard of its own, so an async middleware
          // that throws would otherwise escape as a rejection. A middleware
          // that throws SYNCHRONOUSLY never gets as far as handing back a
          // promise for `.catch` to attach to — composed(context) itself
          // throws — so that case is caught here too, rather than falling
          // through to the outer catch below (which is for setup errors, not
          // middleware failures, and fallback-kinds them 'network').
          let resultPromise: Promise<Result<unknown>>
          try {
            resultPromise = composed(context).catch(
              (err: unknown) => buildFailedResult(err, context.request.signal, 'middleware')
            )
          } catch (err) {
            resultPromise = Promise.resolve(buildFailedResult(err, context.request.signal, 'middleware'))
          }
          return backstop.follow(resultPromise, (result, preempted) => {
            // The end line first, with the final Result — before anything
            // onError prints.
            logEnd?.(result)
            // dedupeController is only assigned inside core() — if every
            // middleware short-circuited and core() never ran, it stays
            // undefined here. clear() with no controller deletes the map
            // entry unconditionally, which would be wrong in that case: it
            // could delete the entry belonging to a genuinely in-flight
            // request registered by someone else under the same name. So
            // only clear when this execute() actually registered.
            //
            // When the backstop won, the request may still be in flight under
            // a middleware-installed signal; abort it before dropping the
            // entry, or nothing can cancel it — see create-api.ts.
            if (operation.config.dedupe && dedupeController) {
              if (preempted) dedupeController.abort()
              dedupeTracker.clear(name, dedupeController)
            }
            releaseAll()
            // One failed shared operation reports once, whichever of its
            // callers gets here first: every caller's error derived from that
            // round trip carries the same token (see core), and
            // ShareTracker.shouldReport lets one token through once. Anything
            // else is untagged and reports as always.
            if (result.error && shareTracker.shouldReport(result.error)) fireOnError(result.error as ApiError)
            return result
          }, (err: unknown) => {
            // A signal-shaped value whose `reason` throws — see create-api.ts.
            releaseAll()
            const result = buildFailedResult(err, undefined, 'abort')
            logEnd?.(result)
            fireOnError(result.error as ApiError)
            return result
          })
        } catch (err) {
          releaseAll()
          const error = new ApiError({
            status: 0,
            kind: 'network',
            statusText: '',
            body: err,
            headers: new Headers(),
            request: { method: 'POST', url: endpoint, params: variables },
          })
          fireOnError(error)
          return Promise.resolve(createNetworkErrorResult(error, execute))
        }
      }

      return execute()
    }

    // Configuration-only headers: no per-call layer and no Content-Type (a call
    // sets that). A fresh record each time. The split client reuses this
    // function object, so `gql.query.x` inherits it.
    return Object.assign(method, {
      // An invalid configured header makes `new Headers()` throw; a public
      // entry point never throws, so that gives {}.
      getHeaders: (): Record<string, string> => {
        try {
          return headersRecord(mergeHeaders(globalHeaders, operation.config.headers, undefined))
        } catch {
          return {}
        }
      },
    })
  }

  const allOperations: Record<string, Operation<any, any>> = {
    ...(config.operations ?? {}),
    ...(config.queries ?? {}),
    ...(config.mutations ?? {}),
  }

  // share joins the in-flight operation, dedupe cancels it: an operation
  // that sets both is a contradiction, refused here at construction rather
  // than at call time — a configuration mistake, not a request failure.
  for (const [name, op] of Object.entries(allOperations)) {
    if (op.config.share && op.config.dedupe) {
      throw new Error(
        `Operation "${name}" sets both share and dedupe. They are opposites — ` +
        `dedupe cancels the previous call, share joins it. Pick one.`
      )
    }
  }

  const flatMethods: Record<string, Function> = {}
  for (const [name, operation] of Object.entries(allOperations)) {
    flatMethods[name] = buildMethod(name, operation)
  }

  if (config.operations) {
    return flatMethods
  }

  const result: Record<string, Record<string, Function>> = {}
  if (config.queries) {
    result.query = {}
    for (const name of Object.keys(config.queries)) {
      result.query[name] = flatMethods[name]
    }
  }
  if (config.mutations) {
    result.mutation = {}
    for (const name of Object.keys(config.mutations)) {
      result.mutation[name] = flatMethods[name]
    }
  }
  return result
}
