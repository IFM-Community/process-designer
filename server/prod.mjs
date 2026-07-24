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

import { createServer } from 'node:http'
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
  const target = K2_URL + url.pathname.replace(/^\/k2/, '') + url.search
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        accept: 'application/json',
        Authorization: `Bearer ${K2_KEY}`,
      },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await rawBody(req),
    })
    const buf = Buffer.from(await upstream.arrayBuffer())
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      'Content-Length': buf.length,
    })
    res.end(buf)
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: `model endpoint unreachable: ${e.message}` }))
  }
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

createServer(async (req, res) => {
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
}).listen(PORT, '0.0.0.0', () => {
  console.log(`[process-designer] listening on :${PORT}`)
  console.log(`[process-designer] database ${DB_FILE}`)
  if (!K2_KEY || !K2_URL) console.warn('[process-designer] WARNING: K2_API_URL/K2_API_KEY not set — AI features will fail')
})
