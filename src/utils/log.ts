// =============================================================================
// log.ts — the request logger behind `log` (both clients) and `logMiddleware`.
// =============================================================================
// Development aid. Uses Date.now(), not performance.now() — some edge runtimes
// lack `performance` (CLAUDE.md). Never changes a Result, and a throwing
// console can never fail a call.
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

/** A logger middleware. `data` also prints the response data (or the error body). */
export function createLogger(data: boolean): Middleware {
  return async (ctx: MiddlewareContext, next: MiddlewareNext<unknown>): Promise<Result<unknown>> => {
    const start = Date.now()
    safely(() => console.log(`[liaise] → ${ctx.request.method} ${ctx.requestName} ${ctx.request.url}`))
    const result = await next()
    const duration = Date.now() - start
    const shared = wasJoined(result) ? ', shared' : ''
    safely(() => {
      if (result.error) console.log(`[liaise] ← ${ctx.requestName} ERROR ${result.error.status} (${duration}ms${shared})`)
      else console.log(`[liaise] ← ${ctx.requestName} OK (${duration}ms${shared})`)
      if (data) printValue(result.error ? result.error.body : result.data)
    })
    return result
  }
}

/** The logger for a client's `log` setting, or null when logging is off (the default). */
export function loggerFor(setting: boolean | LogOptions | undefined): Middleware | null {
  if (setting === undefined || setting === false) return null
  if (setting === true) return createLogger(false)
  if (setting.enabled === false) return null
  return createLogger(setting.data === true)
}
