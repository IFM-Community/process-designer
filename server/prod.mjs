// PRODUCTION server — one process that serves everything, for Railway.
//
// In development there are two halves (Vite on 5173, the API on 5174) with Vite's
// proxy gluing them together. That proxy is a DEV-ONLY feature, so production needs
// its own front door. This is it:
//
//   /api/*   → the same handler the dev API uses (server/api.mjs)
//   /k2/*    → proxied to the model endpoint, with the API key attached HERE so it
//              is never shipped to the browser (same contract as the Vite proxy)
//   /*       → the built frontend from dist/, with SPA fallback to index.html
//
// Binds 0.0.0.0 on $PORT because a container's port must be reachable from outside.

import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { handleApi } from './api.mjs'
import { DB_FILE } from './db.mjs'

const PORT = Number(process.env.PORT || 8080)
const DIST = resolve(process.cwd(), 'dist')
const K2_URL = (process.env.K2_API_URL || '').replace(/\/$/, '') // env-only; never hardcode the endpoint
const K2_KEY = process.env.K2_API_KEY || ''

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

// Read the whole request body — needed to forward a POST to the model.
const rawBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

// The model proxy. The key lives ONLY here (a Railway environment variable); the
// browser calls the same-origin /k2 path and never sees it.
async function proxyK2(req, res, url) {
  if (!K2_URL) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'K2_API_URL is not set on the server' }))
    return
  }
  if (!K2_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'K2_API_KEY is not set on the server' }))
    return
  }
  // Deliberately NOT using fetch() here. Node's fetch (undici) enforces a 300s
  // bodyTimeout — if no response bytes arrive for 5 minutes it aborts. This is a
  // reasoning model: it sends one chunk, then goes SILENT for minutes while it
  // thinks, then bursts the answer. That silence trips undici's 300s timer and the
  // request dies at ~302s ("Lost the connection … while streaming"). node's raw
  // http/https request has no such default, and we disable the socket idle-timeout
  // outright, so the connection survives the long silent think.
  let body
  try {
    body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await rawBody(req)
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: `bad request body: ${e.message}` }))
    return
  }

  const target = new URL(K2_URL + url.pathname.replace(/^\/k2/, '') + url.search)
  const doRequest = target.protocol === 'https:' ? httpsRequest : httpRequest
  const upstreamReq = doRequest(target, {
    method: req.method,
    headers: {
      'Content-Type': req.headers['content-type'] || 'application/json',
      // Forward the caller's Accept so a streaming request stays streaming.
      accept: req.headers['accept'] || 'application/json',
      Authorization: `Bearer ${K2_KEY}`,
      ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {}),
    },
  }, (upstreamRes) => {
    // Forward the reply straight through as bytes arrive. The headers go out
    // immediately (before the model has thought), so Railway's edge sees an active
    // response from the first millisecond and never returns its "Application failed
    // to respond" 502.
    res.writeHead(upstreamRes.statusCode || 502, {
      'Content-Type': upstreamRes.headers['content-type'] || 'application/json',
      'Cache-Control': 'no-cache, no-transform',
      // Tell any intermediary proxy (nginx-style) not to buffer the stream.
      'X-Accel-Buffering': 'no',
    })
    upstreamRes.pipe(res)
    upstreamRes.on('error', () => { try { res.end() } catch { /* already closed */ } })
  })

  // The whole point: no idle timeout on the upstream socket. A silent 5-minute
  // think must not be read as a dead connection.
  upstreamReq.setTimeout(0)
  upstreamReq.on('error', (e) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: `model endpoint unreachable: ${e.message}` }))
    } else {
      try { res.end() } catch { /* already closed */ }
    }
  })
  // If the browser hangs up, stop pulling from the model.
  res.on('close', () => upstreamReq.destroy())

  if (body !== undefined) upstreamReq.write(body)
  upstreamReq.end()
}

// Static files out of dist/, with the SPA fallback every client-routed app needs.
async function serveStatic(req, res, url) {
  // normalize() + the prefix check keeps "../" out of the served path.
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
  let file = normalize(join(DIST, rel))
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end('forbidden'); return }
  if (!existsSync(file)) file = join(DIST, 'index.html') // SPA fallback
  try {
    const buf = await readFile(file)
    const ext = extname(file)
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Hashed assets are immutable; index.html must never be cached or a deploy
      // leaves people on the old bundle.
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    })
    res.end(buf)
  } catch {
    res.writeHead(404); res.end('not found')
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  try {
    if (url.pathname.startsWith('/k2')) return await proxyK2(req, res, url)
    if (url.pathname.startsWith('/api')) {
      if (await handleApi(req, res)) return
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    await serveStatic(req, res, url)
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(e?.message || e) }))
  }
})

// A K2 reasoning call can run for minutes with the connection mostly silent, so
// none of Node's built-in timeouts may cut it: `timeout` is per-socket inactivity,
// `requestTimeout` bounds how long a whole request may take. Both to 0 (disabled);
// `keepAliveTimeout`/`headersTimeout` are left at their defaults (they only govern
// idle keep-alive and header receipt, neither of which is the long phase here).
server.timeout = 0
server.requestTimeout = 0

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[process-designer] listening on :${PORT}`)
  console.log(`[process-designer] database ${DB_FILE}`)
  if (!K2_KEY || !K2_URL) console.warn('[process-designer] WARNING: K2_API_URL/K2_API_KEY not set — AI features will fail')
})
