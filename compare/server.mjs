import http from 'node:http'

/** The test server every contender talks to. State resets per start. */
export async function startServer() {
  let refreshToken = 'r1'
  let accessToken = 'a1'
  const counts = new Map()
  const count = key => counts.set(key, (counts.get(key) ?? 0) + 1)
  const json = (res, status, body) => {
    const payload = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
    res.end(payload)
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    count(`${req.method} ${url.pathname}`)
    switch (url.pathname) {
      case '/s/ok': return json(res, 200, { ok: true })
      case '/s/500': return json(res, 500, { message: 'internal error' })
      case '/s/hang': return // never answers
      case '/s/broken-json':
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end('{"ok": tru')
      case '/s/204': res.writeHead(204); return res.end()
      case '/s/search': {
        const q = url.searchParams.get('q') ?? ''
        await sleep({ 1: 300, 2: 60 }[q.length] ?? 10) // short queries are slow
        return json(res, 200, { q })
      }
      case '/s/orders':
        return req.headers.authorization === `Bearer ${accessToken}`
          ? json(res, 200, { ok: true })
          : json(res, 401, { message: 'token expired' })
      case '/s/refresh': {
        let body = ''
        for await (const chunk of req) body += chunk
        const { token } = JSON.parse(body || '{}')
        if (token !== refreshToken) return json(res, 401, { message: 'refresh token already used' })
        refreshToken = `r${Number(refreshToken.slice(1)) + 1}`
        accessToken = `a${Number(accessToken.slice(1)) + 1}`
        await sleep(30)
        return json(res, 200, { access: accessToken, refresh: refreshToken })
      }
      case '/s/slow-503': await sleep(1000); return json(res, 503, { message: 'overloaded' })
      case '/s/user-wrong': return json(res, 200, { id: '1', name: null })
    }
    if (url.pathname.startsWith('/s/users/')) return json(res, 200, { requested: url.pathname })
    json(res, 404, { message: 'no route' })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    counts,
    close: () => new Promise(r => { server.closeAllConnections(); server.close(r) }),
  }
}

/** A base URL nothing listens on: start a server, note its port, close it. */
export async function deadUrl() {
  const s = http.createServer()
  await new Promise(r => s.listen(0, '127.0.0.1', r))
  const { port } = s.address()
  await new Promise(r => s.close(r))
  return `http://127.0.0.1:${port}`
}
