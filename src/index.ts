// =============================================================================
// index.ts — Public API surface for the liaise library
// =============================================================================
// This barrel file re-exports everything consumers need. Internal modules
// (middleware composition engine, utils) are NOT exported — they are
// implementation details.
// =============================================================================

// ---------------------------------------------------------------------------
// Core — the two things you need to build an API client
// ---------------------------------------------------------------------------

/** Factory that wires Request definitions into a typed, callable API object. */
export { createApi } from './create-api.js'
// A copy of a client — REST or GraphQL — that also sends some headers (5.3.0)
export { withHeaders } from './with-headers.js'
export type { WithHeadersOptions } from './utils/copy.js'

/** Typed request definition — one instance per API endpoint. */
export { Request } from './request.js'

/** Typed factory — infers path params from the `path` literal. */
export { defineRequest } from './define-request.js'

/** Walks a paginated endpoint, yielding one Result per page. */
export { paginate } from './paginate.js'

/** Options for `paginate` — `next`, `maxPages`, and any CallOptions. `Pages` is what it returns: the pages plus `truncated`. */
export type { PaginateOptions, Pages } from './paginate.js'

/** `poll` asks an endpoint again on an interval; `pollUntil` resolves once a condition holds. Callers asking the same thing share one poll. */
export { poll, pollUntil } from './poll.js'

/** Options and the endpoint shape for `poll`. */
export type { Pollable, PollOptions, PollUntilOptions } from './poll.js'

/** A pager over a paginated endpoint: numbered, cursor-based or an infinite list, with a state a UI can subscribe to. */
export { createPager } from './pager.js'

/** The pager, its snapshot and its options: `NumberedPagerOptions`, `CursorPagerOptions` and `ListOptions` combine into `PagerOptions`; `PagerBaseOptions` is what they share. */
export type {
  Pager,
  PagerState,
  PagerOptions,
  NumberedPagerOptions,
  CursorPagerOptions,
  ListOptions,
  PagerBaseOptions
} from './pager.js'

// ---------------------------------------------------------------------------
// Error class — exported as a value so consumers can use `instanceof`
// ---------------------------------------------------------------------------

/** Structured error with status, body, headers, and request context. */
export { ApiError } from './result.js'

// ---------------------------------------------------------------------------
// Types — everything consumers might need for type annotations
// ---------------------------------------------------------------------------

export type {
  RequestConfig,
  ApiConfig,
  LogOptions,
  CallOptions,
  FetchOptions,
  Result,
  SuccessResult,
  ErrorResult,
  Middleware,
  MiddlewareContext,
  MiddlewareNext,
  ApiErrorKind,
  StandardSchemaV1,
  InferOutput,
  StandardIssue
} from './types.js'

// ---------------------------------------------------------------------------
// GraphQL — typed GraphQL client, exported from the core entry point
// ---------------------------------------------------------------------------

/** Factory and primitives for building a typed GraphQL client. */
export { createGraphQL, Operation, gql } from './graphql.js'
export type { GraphQLError, OperationConfig, GraphQLBaseConfig } from './types.js'
