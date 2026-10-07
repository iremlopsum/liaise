// =============================================================================
// exchange.ts — one network round trip, with the body read exactly once.
// =============================================================================
// A Response body can be read once. Under `share`, several callers wait on one
// request, so the read happens here, once, into a neutral form, and each
// caller decodes its own copy from that (create-api.ts `decodeBody`,
// graphql.ts). Without share it is the same code path with one caller.
//
// Both clients use this. They are parallel pipelines (see architecture.md),
// and each keeps its own decoding and error classification; only the read is
// shared, because the read has no client-specific behaviour.
// =============================================================================

import type { ResponseType } from '../types.js'

/** How to read the body. Same values as `ResponseType`. */
export type ReadAs = ResponseType

/** What one round trip produced, before any caller interprets it. */
export interface Exchange {
  response: Response
  /**
   * The body, read once:
   * - text for 'json' and 'text' (and for every non-2xx under 'json'/'text'/'none');
   * - the native object for 'blob' / 'arrayBuffer' / 'formData';
   * - undefined for a 2xx under 'none' (the stream is cancelled).
   */
  body: unknown
  /** True when reading the body failed for a reason other than this request's own signal. */
  readFailed: boolean
  /** The error the read threw, when `readFailed`. */
  readError: unknown
}

/**
 * The body read failed because the request's own signal aborted.
 *
 * Thrown rather than recorded: an abort is the request's outcome, not the
 * body's. `cause` is what the read threw (it becomes `error.body`, as it
 * always has); `reason` is the signal's reason (it decides `kind`).
 *
 * `sendSharedExchange` also throws one for a shared request whose `fetch`
 * rejected because the shared request's own signal aborted: that signal is no
 * caller's, so this is how the provenance reaches each caller's
 * classification. `cause` is then what `fetch` threw.
 */
export class AbortedRead {
  constructor(readonly cause: unknown, readonly reason: unknown) {}
}

async function readBody(response: Response, read: ReadAs): Promise<unknown> {
  // 'none' describes the success shape only; an error body is diagnostic and
  // is read as JSON text, exactly as create-api.ts always did.
  const as = !response.ok && read === 'none' ? 'json' : read
  switch (as) {
    case 'blob':
      return response.blob()
    case 'arrayBuffer':
      return response.arrayBuffer()
    case 'formData':
      return response.formData()
    case 'none':
      // Cancel rather than leave unread: an abandoned body can hold a
      // keep-alive connection open. Cancelling an absent or consumed stream
      // can throw; cleanup must never fail a request.
      //
      // Started, never awaited (5.1.2). On a cloned Response the body is one
      // branch of a tee, and its cancel() does not settle while the other
      // branch is unread — awaiting it hung the call for good. mockFetch's
      // static routes are clones, and so can any fetch wrapper's responses be.
      try {
        response.body?.cancel().catch(() => { /* nothing to release */ })
      } catch {
        /* nothing to release */
      }
      return undefined
    default:
      return response.text()
  }
}

/**
 * `fetch`, then read the body once. `fetch` is looked up at call time (tests stub it).
 *
 * A failed `fetch` rejects as it always did; only the body read is caught.
 * The read is the one step that can fail for two unrelated reasons — the
 * request's own signal aborting mid-download, or the body itself being
 * unreadable — and this is the one place that can tell them apart by
 * provenance: the signal checked is the one handed to `fetch`, at the moment
 * the read failed, before any decoding has run. A parse failure later on
 * therefore can never be mistaken for the abort.
 */
export async function sendExchange(url: string, init: RequestInit, read: ReadAs): Promise<Exchange> {
  const response = await fetch(url, init)
  try {
    return { response, body: await readBody(response, read), readFailed: false, readError: undefined }
  } catch (readError) {
    if (init.signal?.aborted === true) throw new AbortedRead(readError, init.signal.reason)
    return { response, body: undefined, readFailed: true, readError }
  }
}

/**
 * `sendExchange` for a shared request (both clients' share step), with the
 * provenance rule an unshared call applies to the signal it hands `fetch`,
 * applied to the one this request is sent with. An unshared call classifies
 * by its own signal in core's catch; a shared request's signal is no caller's
 * — the refcount plus the shared deadline — so if it aborted (the deadline:
 * abandonment reaches nobody), the failure is that abort, whatever shape
 * `fetch` rejected with. A `fetch` that rejects with its own `AbortError`
 * (whatwg-fetch, React Native) must still read as 'timeout' to every waiting
 * caller.
 */
export function sendSharedExchange(url: string, init: RequestInit & { signal: AbortSignal }, read: ReadAs): Promise<Exchange> {
  const signal = init.signal
  return sendExchange(url, init, read).catch((err: unknown) => {
    if (signal.aborted && !(err instanceof AbortedRead)) throw new AbortedRead(err, signal.reason)
    throw err
  })
}
