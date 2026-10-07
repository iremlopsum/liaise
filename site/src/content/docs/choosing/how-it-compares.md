---
title: "How it compares"
order: 2
---
[`compare/`](https://github.com/iremlopsum/liaise/blob/main/compare) runs fetch, axios, ky, ofetch and liaise through ten failure scenarios against a local server, and records what the calling code gets back. [compare/README.md](https://github.com/iremlopsum/liaise/blob/main/compare/README.md) explains the fairness rules. If you maintain one of these libraries and think its setup is unfair, a pull request is welcome.

<!-- compare:start -->

Measured on 4 October 2026 against axios 1.20.0, ky 2.1.0 and ofetch 1.5.1. Other libraries change. Rerun it with `npm run build` in the repo root, then `npm install && npm run compare` in `compare/`. Run in Node 22.18.0 against a local server. In browsers axios uses XHR, so its results there can differ.

| Scenario | fetch | axios | ky | ofetch | liaise |
| --- | :-- | :-- | :-- | :-- | :-- |
| Server answers 500 | throws Error* | throws AxiosError | throws HTTPError | throws FetchError | error result (http) |
| Server unreachable | throws TypeError* | throws AxiosError (name: Error) | throws NetworkError | throws FetchError | error result (network) |
| Server never answers | throws TimeoutError, 3002 ms* | throws AxiosError, 3006 ms | throws TimeoutError, 3005 ms | throws FetchError, 3004 ms | error result (timeout), 3004 ms |
| 200 with broken JSON | throws SyntaxError* | throws AxiosError (name: SyntaxError) | throws SyntaxError | throws SyntaxError | error result (parse) |
| 204 with no body, on a JSON call | resolves with undefined* | resolves with "" | resolves with undefined | resolves with undefined | resolves with undefined |
| Search as you type: which results stay on screen | shows "rea"* | shows "rea"* | shows "rea"* | shows "rea"* | shows "rea" |
| Five requests get a 401 at once | 1 refresh call, 5/5 succeed* | 1 refresh call, 5/5 succeed* | 1 refresh call, 5/5 succeed* | 1 refresh call, 5/5 succeed* | 1 refresh call, 5/5 succeed* |
| Slow 503s, 3 s deadline, 3 retries: when does the caller hear back | after 3.0s: throws TimeoutError, 3 attempts* | after 3.0s: throws CanceledError, 3 attempts* | after 3.0s: throws TimeoutError, 3 attempts | after 3.0s: throws FetchError, 3 attempts* | after 3.0s: error result (timeout), 3 attempts |
| Path param is undefined | requests /s/users/undefined | requests /s/users/undefined | requests /s/users/undefined | requests /s/users/undefined | refused before sending: error result (network) |
| Response is missing a field the type promises | — | — | throws SchemaValidationError | — | error result (parse) |

\* needed hand-written code, described in the [notes](https://github.com/iremlopsum/liaise/blob/main/compare/results.md#notes). — means the library has no built-in option.

Out of the box, liaise has no timeout (only ky has one by default) and treats a 204 on a JSON call as a parse error. See Table B in [compare/results.md](https://github.com/iremlopsum/liaise/blob/main/compare/results.md).

| Library | gzip (kB) | brotli (kB) |
| --- | :-- | :-- |
| fetch | 0.1 | 0.1 |
| axios | 19.1 | 17.3 |
| ky | 9.6 | 8.5 |
| ofetch | 4.0 | 3.6 |
| liaise | 6.3 | 5.7 |
| liaise + retryMiddleware | 6.8 | 6.2 |

fetch is built into the runtime; its row is the call site only, the floor rather than a library.

Request overhead on localhost, sequential (median requests per second): fetch 17,075, axios 13,972, ky 14,602, ofetch 16,915, liaise 16,912.

Out-of-the-box results, request overhead in full and the notes: [compare/results.md](https://github.com/iremlopsum/liaise/blob/main/compare/results.md).

<!-- compare:end -->

With enough of your own code, every library gets the right result in almost every row. The difference is how much you write. Counting the cells marked `*`, fetch needs 8, axios 3, ofetch 3, ky 2 and liaise 1. liaise needs code only for the token refresh, and returns each failure as a value instead of throwing. It is the only one that refuses an undefined path param before sending the request.

ky is the closest alternative. Apart from throwing instead of returning errors, it differs from liaise in two rows of the table. Its search as you type needs code, and it sends the undefined path param. Out of the box, ky is the only one that times out, and it retries, as ofetch does. In size, liaise is larger than ofetch and smaller than ky and axios.

In request overhead, liaise ties fetch and ofetch. axios handles about 17% and ky about 14% fewer requests per second than liaise. Overhead is measured in microseconds; on a real network each request takes milliseconds.
