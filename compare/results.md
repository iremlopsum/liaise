# Comparison results

Measured on 7 October 2026 against axios 1.20.0, ky 2.1.0 and ofetch 1.5.1. Other libraries change. Rerun it with `npm run build` in the repo root, then `npm install && npm run compare` in `compare/`.

Run on 2026-10-07, Node v22.18.0, darwin arm64, against a local server. Versions: fetch v22.18.0, axios 1.20.0, ky 2.1.0, ofetch 1.5.1, liaise 5.3.0. In browsers axios uses XHR, so its results there can differ.

## Table A. With each library's documented setup

| Scenario | fetch | axios | ky | ofetch | liaise |
| --- | :-- | :-- | :-- | :-- | :-- |
| Server answers 500 | throws Error* | throws AxiosError | throws HTTPError | throws FetchError | error result (http) |
| Server unreachable | throws TypeError* | throws AxiosError (name: Error) | throws NetworkError | throws FetchError | error result (network) |
| Server never answers | throws TimeoutError, 3006 ms* | throws AxiosError, 3011 ms | throws TimeoutError, 3010 ms | throws FetchError, 3007 ms | error result (timeout), 3008 ms |
| 200 with broken JSON | throws SyntaxError* | throws AxiosError (name: SyntaxError) | throws SyntaxError | throws SyntaxError | error result (parse) |
| 204 with no body, on a JSON call | resolves with undefined* | resolves with "" | resolves with undefined | resolves with undefined | resolves with undefined |
| Search as you type: which results stay on screen | shows "rea"* | shows "rea"* | shows "rea"* | shows "rea"* | shows "rea" |
| Five requests get a 401 at once | 1 refresh call, 5/5 succeed* | 1 refresh call, 5/5 succeed* | 1 refresh call, 5/5 succeed* | 1 refresh call, 5/5 succeed* | 1 refresh call, 5/5 succeed* |
| Slow 503s, 3 s deadline, 3 retries: when does the caller hear back | after 3.0s: throws TimeoutError, 3 attempts* | after 3.0s: throws CanceledError, 3 attempts* | after 3.0s: throws TimeoutError, 3 attempts | after 3.0s: throws FetchError, 3 attempts* | after 3.0s: error result (timeout), 3 attempts |
| Path param is undefined | requests /s/users/undefined | requests /s/users/undefined | requests /s/users/undefined | requests /s/users/undefined | refused before sending: error result (network) |
| Response is missing a field the type promises | — | — | throws SchemaValidationError | — | error result (parse) |

\* needed hand-written code, described in the notes.
`—` means the library has no built-in option for that scenario. Milliseconds are shown only where timing is the point.

## Table B. Out of the box

| Scenario | fetch | axios | ky | ofetch | liaise |
| --- | :-- | :-- | :-- | :-- | :-- |
| Server answers 500 | wrong data | throws AxiosError | throws HTTPError | throws FetchError | error result (http) |
| Server unreachable | throws TypeError | throws AxiosError (name: Error) | throws NetworkError | throws FetchError | error result (network) |
| Server never answers | still waiting after 15s | still waiting after 15s | throws TimeoutError, 10008 ms | still waiting after 15s | still waiting after 15s |
| 200 with broken JSON | throws SyntaxError | wrong data | throws SyntaxError | wrong data | error result (parse) |
| 204 with no body, on a JSON call | throws SyntaxError | resolves with "" | throws SyntaxError | resolves with undefined | error result (parse) |
| Search as you type: which results stay on screen | shows "r" | shows "r" | shows "r" | shows "r" | shows "r" |
| Five requests get a 401 at once | 5 refresh calls, 1/5 succeed* | 5 refresh calls, 1/5 succeed* | 5 refresh calls, 1/5 succeed* | 5 refresh calls, 1/5 succeed* | 5 refresh calls, 1/5 succeed* |
| Slow 503s, 3 s deadline, 3 retries: when does the caller hear back | after 1.0s: wrong data, 1 attempt | after 1.0s: throws AxiosError, 1 attempt | after 3.9s: throws HTTPError, 3 attempts | after 2.0s: throws FetchError, 2 attempts | after 1.0s: error result (http), 1 attempt |
| Path param is undefined | requests /s/users/undefined | requests /s/users/undefined | requests /s/users/undefined | requests /s/users/undefined | refused before sending: error result (network) |
| Response is missing a field the type promises | wrong data | wrong data | wrong data | wrong data | wrong data |

\* needed hand-written code, described in the notes.

Reading guide: a 204 and a slow server are normal. An error, or still waiting, in those rows is a failure.

## Table C. Size

One JSON GET, minified ES2020 ESM bundle for a browser.

| Library | gzip (kB) | brotli (kB) |
| --- | :-- | :-- |
| fetch | 0.1 | 0.1 |
| axios | 19.1 | 17.3 |
| ky | 9.6 | 8.5 |
| ofetch | 4.0 | 3.6 |
| liaise | 7.0 | 6.4 |
| liaise + retryMiddleware | 7.6 | 6.9 |

fetch is built into the runtime; its row is the call site only, the floor rather than a library.

## Table D. Requests per second on localhost

Median (min–max) of 10 interleaved rounds of 2,000 calls each, after 2,000 warm-up calls per library. localhost, keep-alive as each library defaults; a real network adds milliseconds per request, this measures microseconds. Differences under about 5% are noise.

| Library | Sequential | Concurrent (50 in flight) |
| --- | :-- | :-- |
| fetch | 16,550 (14,668–17,117) | 19,496 (17,587–20,150) |
| axios | 13,540 (11,196–13,872) | 15,556 (14,322–16,090) |
| ky | 13,721 (12,672–14,694) | 15,895 (15,217–16,246) |
| ofetch | 16,157 (15,632–16,639) | 18,840 (18,412–19,610) |
| liaise | 16,131 (15,574–16,791) | 18,797 (17,854–19,341) |

## Notes

### fetch

- getJson: hand-written: res.ok check that throws (https://developer.mozilla.org/en-US/docs/Web/API/Response/ok), signal: AbortSignal.timeout(3000) (https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static), skip parsing a 204
- getUser: same as default; fetch has no path-param option
- search: hand-written: abort the previous call with AbortController (https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- getWithAuth: hand-written: one shared refresh promise, retry once
- getWithDeadline: hand-written: loop of 4 attempts under one AbortSignal.timeout(3000) (https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
- getValidated: no built-in option
- getWithAuth (out of the box): hand-written: naive refresh on 401, retry once

### axios

- getJson: timeout: 3000 (https://github.com/axios/axios/blob/v1.20.0/README.md#handling-timeouts); responseType: 'json' + transitional.silentJSONParsing: false (https://github.com/axios/axios/blob/v1.20.0/README.md#request-config)
- search: hand-written: abort the previous call with signal + AbortController (https://github.com/axios/axios/blob/v1.20.0/README.md#abortcontroller)
- getWithAuth: hand-written: refresh in a response interceptor (https://github.com/axios/axios/blob/v1.20.0/README.md#interceptors), one shared refresh promise
- getWithDeadline: hand-written: loop of 4 attempts under one AbortSignal.timeout(3000) (https://github.com/axios/axios/blob/v1.20.0/README.md#abortcontroller)
- getValidated: no built-in option
- getWithAuth (out of the box): hand-written: naive refresh on 401, retry once

### ky

- getJson: timeout: 3000 (https://github.com/sindresorhus/ky/blob/v2.1.0/readme.md#timeout); parseJson handles an empty body (https://github.com/sindresorhus/ky/blob/v2.1.0/readme.md#parsejson)
- search: hand-written: abort the previous call with signal + AbortController (https://github.com/sindresorhus/ky/blob/v2.1.0/readme.md#cancellation)
- getWithAuth: hand-written: one shared refresh promise in beforeRetry (readme FAQ: token refresh, https://github.com/sindresorhus/ky/blob/v2.1.0/readme.md#how-do-i-implement-token-refresh-on-401-responses); FAQ default: up to 2 retries
- getWithDeadline: timeout: 3000, totalTimeout: 3000, retry: { limit: 3 } (https://github.com/sindresorhus/ky/blob/v2.1.0/readme.md#totaltimeout, https://github.com/sindresorhus/ky/blob/v2.1.0/readme.md#retry)
- getValidated: .json(schema), Standard Schema (https://github.com/sindresorhus/ky/blob/v2.1.0/readme.md#kyinput-options)
- getWithAuth (out of the box): hand-written: naive refresh on 401, retry once

### ofetch

- getJson: timeout: 3000 (https://github.com/unjs/ofetch/blob/v1.5.1/README.md#%EF%B8%8F-timeout); parseResponse: JSON.parse (https://github.com/unjs/ofetch/blob/v1.5.1/README.md#%EF%B8%8F-parsing-response)
- search: hand-written: abort the previous call with signal + AbortController (https://developer.mozilla.org/en-US/docs/Web/API/AbortController); signal is a fetch option passed through; the ofetch README has no cancellation section
- getWithAuth: hand-written: refresh in onResponseError (https://github.com/unjs/ofetch/blob/v1.5.1/README.md#onresponseerror-request-options-response-) + retry: 1, retryStatusCodes: [401] (https://github.com/unjs/ofetch/blob/v1.5.1/README.md#%EF%B8%8F-auto-retry), one shared refresh promise
- getWithDeadline: retry: 3 (https://github.com/unjs/ofetch/blob/v1.5.1/README.md#%EF%B8%8F-auto-retry); hand-written: overall deadline via signal: AbortSignal.timeout(3000) (https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static). ofetch's `timeout` is per attempt; it has no overall-deadline option (https://github.com/unjs/ofetch/blob/v1.5.1/README.md#%EF%B8%8F-timeout)
- getValidated: no built-in option
- getWithAuth (out of the box): hand-written: naive refresh on 401, retry once

### liaise

- getJson: timeout: 3000 (https://iremlopsum.github.io/liaise/guide/cancelling-deadlines-and-stale-requests/#set-a-deadline-with-timeout); responseType: 'none' declared on the 204 endpoint; liaise has no option for an endpoint that answers JSON or an empty body (https://iremlopsum.github.io/liaise/guide/reading-responses/)
- search: dedupe: true (https://iremlopsum.github.io/liaise/guide/cancelling-deadlines-and-stale-requests/#drop-stale-calls-with-dedupe)
- getWithAuth: hand-written: auth middleware from the auth recipe (https://iremlopsum.github.io/liaise/recipes/add-an-auth-header-and-refresh-the-token-on-a-401/); share: true on refresh replaces the shared refresh promise
- getWithDeadline: timeout: 3000 (https://iremlopsum.github.io/liaise/guide/cancelling-deadlines-and-stale-requests/#set-a-deadline-with-timeout) + retryMiddleware({ max: 3 }) (https://iremlopsum.github.io/liaise/guide/retries-caching-and-logging/#retry-failed-calls)
- getValidated: schema, Standard Schema (https://iremlopsum.github.io/liaise/guide/validating-responses/)
- getWithAuth (out of the box): hand-written: same refresh middleware, without share
