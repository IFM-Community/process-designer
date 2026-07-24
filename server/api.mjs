// API in front of the store (SQLite or Postgres).
//
// WORKSPACES WITH OPTIONAL PASSWORDS, STILL NO ACCOUNTS. A workspace is reached
// by its id (which lives in its share link). An OPEN workspace is an unlisted
// document — the link is the grant. A LOCKED workspace additionally requires its
// password once: the server then hands the browser an access token, sent as the
// x-pd-token header on every read/write.
//
// The token is HMAC(secret, id + password_hash) — stateless to verify, and
// changing the password rotates the hash, which silently invalidates every token
// out there. The secret is minted once and kept in the store's meta table, so
// both server instances and both store backends agree on it.
//
// (The old users/memberships tables still exist unused, so an SSO layer can be
// added later without a migration.)

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import {
  DB_FILE, STORE_KIND, readState, writeState, deleteSession, listRevisions, getRevision,
  createStudio, getStudio, getStudioFull, listAllStudios, setStudioPassword, deleteStudio,
  getMetaValue, setMetaValue, renameStudio, sessionStudioId,
} from './store/index.mjs'

// ---- Passwords & tokens ---------------------------------------------------
let SECRET = null
async function secret() {
  if (SECRET) return SECRET
  let v = await getMetaValue('server_secret')
  if (!v) { v = randomBytes(32).toString('hex'); await setMetaValue('server_secret', v) }
  SECRET = v
  return v
}

const hashPassword = (pw) => {
  const salt = randomBytes(16).toString('hex')
  return `${salt}$${scryptSync(String(pw), salt, 32).toString('hex')}`
}
const verifyPassword = (pw, stored) => {
  const [salt, hex] = String(stored || '').split('$')
  if (!salt || !hex) return false
  const a = scryptSync(String(pw), salt, 32)
  const b = Buffer.from(hex, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

const tokenFor = async (id, passwordHash) =>
  createHmac('sha256', await secret()).update(`${id}:${passwordHash}`).digest('hex')

// Can this request touch this workspace? Open workspace → yes. Locked → only
// with a token minted from the CURRENT password.
async function hasAccess(req, url, studio) {
  if (!studio?.password_hash) return true
  const sent = req.headers['x-pd-token'] || url.searchParams.get('t') || ''
  const want = await tokenFor(studio.id, studio.password_hash)
  return sent.length === want.length && timingSafeEqual(Buffer.from(sent), Buffer.from(want))
}

const json = (res, code, body, headers = {}) => {
  const s = JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s), ...headers })
  res.end(s)
  return true // every API branch `return json(...)` — truthy means "I handled it"
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => { raw += c; if (raw.length > 25e6) { reject(new Error('payload too large')); req.destroy() } })
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch (e) { reject(e) } })
    req.on('error', reject)
  })


// The API request handler, shared by the dev server (server/index.mjs) and the
// production server (server/prod.mjs, which also serves the built frontend and
// proxies the model endpoint). Returns true when it handled the request.
export async function handleApi(req, res) {

  const url = new URL(req.url, 'http://localhost')
  const { pathname } = url
  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      return json(res, 200, { ok: true, db: DB_FILE, store: STORE_KIND })
    }

    // ---- Workspaces ----------------------------------------------------
    // The gallery: every workspace's name, size and lock state. Contents stay
    // behind the password; the list itself is the front door of an internal tool.
    if (req.method === 'GET' && pathname === '/api/studios/list') {
      return json(res, 200, { studios: await listAllStudios() })
    }
    if (req.method === 'POST' && pathname === '/api/studios') {
      const { name, password } = await readBody(req)
      const studio = await createStudio((name || '').trim() || 'New workspace') // ownerless
      let token = null
      if (password) {
        const hash = hashPassword(password)
        await setStudioPassword(studio.id, hash)
        token = await tokenFor(studio.id, hash)
      }
      return json(res, 200, { studio: { id: studio.id, name: studio.name }, token })
    }
    // Metadata for a workspace you hold a link to — name, count, locked?
    if (req.method === 'GET' && pathname === '/api/studio') {
      const id = url.searchParams.get('id')
      if (!id) return json(res, 400, { error: 'id required' })
      const s = await getStudio(id)
      return s ? json(res, 200, s) : json(res, 404, { error: 'workspace not found' })
    }
    // Password → token. The only place a password ever travels.
    if (req.method === 'POST' && pathname === '/api/studio/unlock') {
      const { id, password } = await readBody(req)
      const full = id && (await getStudioFull(id))
      if (!full) return json(res, 404, { error: 'workspace not found' })
      if (!full.password_hash) return json(res, 200, { token: null }) // open — nothing to unlock
      if (!verifyPassword(password, full.password_hash)) return json(res, 403, { error: 'wrong password' })
      return json(res, 200, { token: await tokenFor(id, full.password_hash) })
    }

    // Everything below acts ON a workspace, so resolve + authorise it once.
    // Body-carried ids (rename/password/delete) and query-carried ids (state)
    // both land here.
    const body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : {}
    const studioId = url.searchParams.get('studio') || body.id || null
    const authed = async () => {
      if (!studioId) return { code: 400, error: 'workspace id required' }
      const full = await getStudioFull(studioId)
      if (!full) return { code: 404, error: 'workspace not found' }
      if (!(await hasAccess(req, url, full))) return { code: 403, error: 'locked — wrong or missing password' }
      return { ok: true, full }
    }

    if (req.method === 'POST' && pathname === '/api/studio/rename') {
      const a = await authed()
      if (!a.ok) return json(res, a.code, { error: a.error })
      await renameStudio(studioId, (body.name || '').trim() || 'Workspace')
      return json(res, 200, await getStudio(studioId))
    }
    // Set, change or clear the password. Requires current access, so a stranger
    // can't lock you out of an open workspace you shared... they'd have the link
    // too, granted — this is a courtesy lock, not Fort Knox.
    if (req.method === 'POST' && pathname === '/api/studio/password') {
      const a = await authed()
      if (!a.ok) return json(res, a.code, { error: a.error })
      const hash = body.password ? hashPassword(body.password) : null
      await setStudioPassword(studioId, hash)
      return json(res, 200, { ok: true, token: hash ? await tokenFor(studioId, hash) : null })
    }
    if (req.method === 'DELETE' && pathname === '/api/studio') {
      const a = await authed()
      if (!a.ok) return json(res, a.code, { error: a.error })
      await deleteStudio(studioId)
      return json(res, 200, { ok: true })
    }

    // ---- Studio-scoped process state -----------------------------------
    if (req.method === 'GET' && pathname === '/api/state') {
      const a = await authed()
      if (!a.ok) return json(res, a.code, { error: a.error })
      return json(res, 200, await readState(studioId))
    }
    if (req.method === 'PUT' && pathname === '/api/state') {
      const a = await authed()
      if (!a.ok) return json(res, a.code, { error: a.error })
      if (!Array.isArray(body.sessions)) return json(res, 400, { error: 'sessions must be an array' })
      return json(res, 200, await writeState(studioId, body))
    }
    if (req.method === 'DELETE' && pathname === '/api/session') {
      const a = await authed()
      if (!a.ok) return json(res, a.code, { error: a.error })
      const id = url.searchParams.get('id')
      if (!id) return json(res, 400, { error: 'id required' })
      return json(res, 200, await deleteSession(studioId, id))
    }

    // ---- Revisions — same gate as the state routes, plus the session must
    // actually belong to the named workspace.
    if (req.method === 'GET' && pathname === '/api/revisions') {
      const a = await authed()
      if (!a.ok) return json(res, a.code, { error: a.error })
      const id = url.searchParams.get('session')
      if (!id) return json(res, 400, { error: 'session required' })
      if ((await sessionStudioId(id)) !== studioId) return json(res, 403, { error: 'no access' })
      return json(res, 200, { revisions: await listRevisions(id) })
    }
    if (req.method === 'GET' && pathname === '/api/revision') {
      const a = await authed()
      if (!a.ok) return json(res, a.code, { error: a.error })
      const rev = await getRevision(Number(url.searchParams.get('id')))
      if (!rev) return json(res, 404, { error: 'not found' })
      if ((await sessionStudioId(rev.id)) !== studioId) return json(res, 403, { error: 'no access' })
      return json(res, 200, rev)
    }

    return false
  } catch (e) {
    return json(res, 500, { error: String(e?.message || e) })
  }

}
