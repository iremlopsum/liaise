// Placeholders that docs examples use without defining — "your UI code".
// Type-checked snippets see these as globals (scripts/check-doc-types.mjs).
declare function show(message: string): void
declare function render(data: unknown): void
declare function showError(error: import('liaise').ApiError): void
declare function report(error: unknown): void
declare function redirectToLogin(): void
declare type User = { id: string; name: string; email?: string }
declare type Repo = { id: string; name: string }
declare type Product = { id: string; name: string }
declare type Report = { id: string; total: number }
declare const id: string
declare const order: { items: string[] }

// Names the docs import once and then keep using in later blocks. Declared as globals so a
// fragment that omits the import still checks against the real library types. A block that
// does import them shadows these.
declare const createApi: typeof import('liaise').createApi
declare const defineRequest: typeof import('liaise').defineRequest
declare const createGraphQL: typeof import('liaise').createGraphQL
declare const gql: typeof import('liaise').gql
declare const retryMiddleware: typeof import('liaise/middleware').retryMiddleware
declare type Middleware = import('liaise').Middleware
declare type ApiError = import('liaise').ApiError
declare const Operation: typeof import('liaise').Operation
declare type Operation<T = any, V = any> = import('liaise').Operation<T, V>

// Clients and requests the earlier blocks of a page have already built.
declare const api: any
declare const getUser: any
declare const user: { id: string; name: string; getIdToken(): Promise<string> }
declare const graphql: any
declare const expect: any
declare const vi: any
declare const GET_CATEGORY: ReturnType<typeof import('liaise').gql>
declare type Category = { id: string; name: string; status: string }
declare type Doc = { id: string; title: string }
// Vite's env, which the logging example reads.
interface ImportMeta { env: { DEV: boolean } }
declare const error: ApiError
declare function getToken(): string
declare function refreshToken(): Promise<void>
declare function logToTracker(error: unknown): void

// Packages the docs import but the library does not depend on.
declare module 'zod' { export const z: any }
declare module 'valibot' { const v: any; export = v }
declare module 'arktype' { export const type: any }
declare module '@sentry/browser' { export function captureException(e: unknown, ctx?: unknown): void; export function captureMessage(m: string, ctx?: unknown): void }
