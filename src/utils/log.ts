// =============================================================================
// log.ts — the request logger behind `log` (both clients) and `logMiddleware`.
// =============================================================================
// Development aid. Uses Date.now(), not performance.now() — some edge runtimes
// lack `performance` (CLAUDE.md). Never changes a Result, and a throwing
// console can never fail a call.
//
// One pair of lines, printed by `begin`, two ways:
// - `logMiddleware` (`createLogger`, `loggerFor`) is a middleware, and times
//   whatever runs inside it.
// - A client's `log` option (`callLoggerFor`) is NOT a middleware. Each
//   call's execute() prints the start line just before its chain runs, and
//   the end line from the post-execution hook, with the Result the caller
//   receives. A middleware is inside the backstop (utils/backstop.ts), so a
//   logger there never sees the Result of a call the backstop settles — a
//   middleware stuck on something the signal does not reach — and printed its
//   end line late, with an inflated time, or never.
// =============================================================================

import type { LogOptions, Middleware, MiddlewareContext, MiddlewareNext, Result } from '../types.js'
import { wasJoined } from './share.js'

function safely(write: () => void): void {
  try {
    write()
  } catch {
    /* logging must never fail a call */
  }
}

function printValue(value: unknown): void {
  const table = (console as { table?: (v: unknown) => void }).table
  if (value !== null && typeof value === 'object' && typeof table === 'function') table.call(console, value)
  else console.log(value)
}

/** Prints a call's end line (and its data, with `data`). Once: a second call is ignored. */
export type EndLine = (result: Result<unknown>) => void

/**
 * Prints `ctx`'s start line now and starts the clock; the function it returns
 * prints the end line for `result`. That function ignores every call after
 * the first, so a caller with two paths to a final Result (a client's
 * post-execution hook and the backstop's `onFailure` behind it) cannot print
 * two end lines.
 */
function begin(ctx: MiddlewareContext, data: boolean): EndLine {
  const start = Date.now()
  safely(() => console.log(`[liaise] → ${ctx.request.method} ${ctx.requestName} ${ctx.request.url}`))
  let done = false
  return result => {
    if (done) return
    done = true
    const duration = Date.now() - start
    safely(() => {
      // Inside `safely` too: `result` is whatever the chain resolved to, and
      // a broken middleware can hand back anything.
      const shared = wasJoined(result) ? ', shared' : ''
      if (result.error) console.log(`[liaise] ← ${ctx.requestName} ERROR ${result.error.status} (${duration}ms${shared})`)
      else console.log(`[liaise] ← ${ctx.requestName} OK (${duration}ms${shared})`)
      if (data) printValue(result.error ? result.error.body : result.data)
    })
  }
}

/** A logger middleware. `data` also prints the response data (or the error body). */
export function createLogger(data: boolean): Middleware {
  return async (ctx: MiddlewareContext, next: MiddlewareNext<unknown>): Promise<Result<unknown>> => {
    const end = begin(ctx, data)
    const result = await next()
    end(result)
    return result
  }
}

/** `data` for a `log` setting, or null when logging is off (the default). */
function dataFor(setting: boolean | LogOptions | undefined): boolean | null {
  if (setting === undefined || setting === false) return null
  if (setting === true) return false
  if (setting.enabled === false) return null
  return setting.data === true
}

/** The logger middleware for a `logMiddleware(options)` setting, or null when logging is off. */
export function loggerFor(setting: boolean | LogOptions | undefined): Middleware | null {
  const data = dataFor(setting)
  return data === null ? null : createLogger(data)
}

/**
 * A client's `log` setting as a call logger, or null when logging is off (the
 * default), so an off logger costs nothing. Each call's `execute()` calls it
 * with the middleware context just before the chain runs, which prints the
 * start line, and hands the final Result to what it returns, from the
 * post-execution hook. See the header for why this is not a middleware.
 */
export function callLoggerFor(setting: boolean | LogOptions | undefined): ((ctx: MiddlewareContext) => EndLine) | null {
  const data = dataFor(setting)
  return data === null ? null : ctx => begin(ctx, data)
}
