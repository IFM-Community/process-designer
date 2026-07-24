// DEV API server: the SQLite API on its own port, which Vite proxies to.
// The request handling itself lives in api.mjs so the production server
// (server/prod.mjs) serves exactly the same API.

import { createServer } from 'node:http'
import { handleApi } from './api.mjs'
import { DB_FILE } from './db.mjs'

const PORT = Number(process.env.PD_API_PORT || 5174)

createServer(async (req, res) => {
  if (await handleApi(req, res)) return
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[pd-api] http://127.0.0.1:${PORT}  →  ${DB_FILE}`)
})
