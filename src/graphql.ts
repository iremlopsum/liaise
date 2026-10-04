import { ApiError, createSuccessResult, createErrorResult, createNetworkErrorResult } from './result.js'
import { composeMiddleware } from './middleware.js'
import { DedupeTracker } from './utils/dedupe.js'
import { mergeHeaders } from './utils/headers.js'
import { abortKind, propagatesReason } from './utils/abort-kind.js'
import { resolveBudget } from './utils/budget.js'
import { releaseSignal } from './utils/any-signal.js'
import { createBackstop } from './utils/backstop.js'
import { runSchema } from './utils/validate.js'
import type { SchemaOutcome } from './utils/validate.js'
import { sendExchange, AbortedRead } from './utils/exchange.js'
import type { CallOptions, ErrorResult, Middleware, MiddlewareContext, Result, GraphQLBaseConfig, OperationConfig, GraphQLError } from './types.js'

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
  Record<string, never> extends TVariables
    ? (variables?: TVariables, options?: CallOptions) => Promise<Result<TData>>
    : (variables: TVariables, options?: CallOptions) => Promise<Result<TData>>

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
  } = config

  const dedupeTracker = new DedupeTracker()

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
    return (variables: object = {}, options: CallOptions = {}): Promise<Result<unknown>> => {
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
          // Resolve the deadline: per-call beats per-operation, and non-positive
          // means none. The signal is created once here — not inside core() —
          // so a retry sequence draws from a single budget rather than getting
          // a fresh one per attempt.
          //
          // GraphQL never coalesces, so the operation's deadline and this
          // caller's patience are the same signal — both budget fields are
          // identical and either may be read.
          const budget = resolveBudget(options.timeout, operation.config.timeout, options.signal, false)
          const callerSignal: AbortSignal | undefined = budget.operation
          own(callerSignal, options.signal)
          let dedupeController: AbortController | undefined

          const core = async (ctx: MiddlewareContext): Promise<Result<unknown>> => {
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

              // fetch, then the body read, exactly once, as text — the same
              // helper create-api.ts uses. A read our own signal aborted
              // throws AbortedRead, classified in the outer catch below; any
              // other read failure is recorded on the exchange and rethrown
              // at the point each branch below used to do its own read.
              const exchange = await sendExchange(
                ctx.request.url,
                {
                  method: 'POST',
                  headers: ctx.request.headers,
                  body: ctx.request.body as string,
                  signal: ctx.request.signal,
                },
                'text'
              )
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
              // A failed read is rethrown OUTSIDE that try, deliberately, and
              // lands in the outer `catch (err)` as status 0. That is where
              // this read has always sat (it used to be the `await
              // response.text()` on this line), so a body stream that breaks
              // mid-download is a 'network' failure here — unlike
              // create-api.ts, whose success-path read sat inside its parse
              // try and reports the same break as 'parse'. An abort during
              // the read never gets this far: it is an AbortedRead from
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
              // the body, as before.
              const aborted = err instanceof AbortedRead
              const signal = ctx.request.signal
              const kind = signal?.aborted === true
                ? (abortKind(signal.reason) ?? 'abort')
                : (abortKind(aborted ? err.reason : err) ?? 'network')
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
          // matching block in create-api.ts's execute().
          const backstop = createBackstop<Result<unknown>>(signal =>
            buildFailedResult(signal.reason, signal, 'abort')
          )
          backstop.watch(callerSignal)
          const composed = composeMiddleware(allMiddleware, backstop.guard(core), options.skipMiddleware ?? [])
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
            if (result.error) fireOnError(result.error as ApiError)
            return result
          }, (err: unknown) => {
            // A signal-shaped value whose `reason` throws — see create-api.ts.
            releaseAll()
            const result = buildFailedResult(err, undefined, 'abort')
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
  }

  const allOperations: Record<string, Operation<any, any>> = {
    ...(config.operations ?? {}),
    ...(config.queries ?? {}),
    ...(config.mutations ?? {}),
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
