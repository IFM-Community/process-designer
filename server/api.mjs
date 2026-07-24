// API in front of the SQLite store.
//
// Every request is authenticated to a USER (via an opaque cookie session) and every
// data route is scoped to a STUDIO the user belongs to. The auth is deliberately
// pluggable: `mock-login` stands in for a real identity provider today, and Google
// sign-in / Entra SSO will replace ONLY that endpoint — they upsert the same user
// and mint the same cookie, so nothing downstream changes.
//
// Still bound to 127.0.0.1 for local dev. To host it for a team, bind 0.0.0.0
// behind HTTPS and set the cookie `Secure` (see SECURE below).

import {
  DB_FILE, STORE_KIND, readState, writeState, deleteSession, listRevisions, getRevision,
  upsertUser, ensureDefaultUser, createAuthSession, userForToken, endAuthSession,
  listStudios, createStudio, isMember, membership, listMembers, renameStudio,
  createInvite, listInvites, sessionStudioId,
} from './store/index.mjs'

const SECURE = process.env.PD_HTTPS === '1' // set when served over https
// While the login UI is being built, auth is OPTIONAL: an unauthenticated request
// runs as the default user so the existing single-user frontend keeps working.
// Flip PD_REQUIRE_AUTH=1 (once the login gate ships) to demand real sign-in.
const REQUIRE_AUTH = process.env.PD_REQUIRE_AUTH === '1'

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

const parseCookies = (req) => Object.fromEntries(
  (req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((p) => p[0]),
)

const AUTH_COOKIE = 'pd_auth'
const setAuthCookie = (token) =>
  `${AUTH_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}${SECURE ? '; Secure' : ''}`
const clearAuthCookie = () => `${AUTH_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${SECURE ? '; Secure' : ''}`

const userOf = (req) => userForToken(parseCookies(req)[AUTH_COOKIE])
const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, avatar: u.avatar }
const mePayload = async (u) => ({ user: publicUser(u), studios: await listStudios(u.id) })


// The API request handler, shared by the dev server (server/index.mjs) and the
// production server (server/prod.mjs, which also serves the built frontend and
// proxies the model endpoint). Returns true when it handled the request.
export async function handleApi(req, res) {

  const url = new URL(req.url, 'http://localhost')
  const { pathname } = url
  try {
    // ---- Auth ----------------------------------------------------------
    // The ONE endpoint a real IdP replaces. Given a verified {email, name}, it
    // upserts the user, claims any pending invites, and starts a login session.
    if (req.method === 'POST' && pathname === '/api/auth/mock-login') {
      const { email, name, avatar } = await readBody(req)
      if (!email || !String(email).includes('@')) return json(res, 400, { error: 'a valid email is required' })
      const user = await upsertUser({ email, name, avatar })
      const token = await createAuthSession(user.id)
      return json(res, 200, await mePayload(user), { 'Set-Cookie': setAuthCookie(token) })
    }
    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      await endAuthSession(parseCookies(req)[AUTH_COOKIE])
      return json(res, 200, { ok: true }, { 'Set-Cookie': clearAuthCookie() })
    }
    if (req.method === 'GET' && pathname === '/api/me') {
      const u = await userOf(req)
      return u ? json(res, 200, await mePayload(u)) : json(res, 401, { error: 'not signed in' })
    }

    // Everything below needs a user. Real sign-in when required; otherwise the
    // default single-user fallback so the current frontend works untouched.
    const user = (await userOf(req)) || (REQUIRE_AUTH ? null : await ensureDefaultUser())
    if (!user) return json(res, 401, { error: 'not signed in' })

    // ---- Studios -------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/studios') {
      return json(res, 200, { studios: await listStudios(user.id) })
    }
    if (req.method === 'POST' && pathname === '/api/studios') {
      const { name } = await readBody(req)
      const studio = await createStudio((name || '').trim() || 'New studio', user.id)
      return json(res, 200, { studio, studios: await listStudios(user.id) })
    }

    // /api/studios/:id/(members|invites|rename)
    const sm = pathname.match(/^\/api\/studios\/([^/]+)\/(members|invites|rename)$/)
    if (sm) {
      const studioId = decodeURIComponent(sm[1])
      const sub = sm[2]
      const mem = await membership(studioId, user.id)
      if (!mem) return json(res, 403, { error: 'not a member of this studio' })

      if (sub === 'members' && req.method === 'GET') return json(res, 200, { members: await listMembers(studioId) })
      if (sub === 'invites' && req.method === 'GET') return json(res, 200, { invites: await listInvites(studioId) })
      if (sub === 'invites' && req.method === 'POST') {
        if (mem.role === 'viewer') return json(res, 403, { error: 'viewers cannot invite' })
        const { email, role } = await readBody(req)
        if (!email || !String(email).includes('@')) return json(res, 400, { error: 'a valid email is required' })
        const r = await createInvite(studioId, email, role === 'viewer' ? 'viewer' : 'editor', user.email)
        return json(res, 200, { ...r, members: await listMembers(studioId), invites: await listInvites(studioId) })
      }
      if (sub === 'rename' && req.method === 'POST') {
        if (mem.role !== 'owner') return json(res, 403, { error: 'only the owner can rename the studio' })
        const { name } = await readBody(req)
        await renameStudio(studioId, (name || '').trim() || 'Studio')
        return json(res, 200, { ok: true, studios: await listStudios(user.id) })
      }
    }

    // ---- Studio-scoped process state -----------------------------------
    // Default to the user's first studio when the client doesn't name one — the
    // current frontend is studio-unaware, so this keeps /api/state working before
    // the studio switcher ships.
    const studioId = url.searchParams.get('studio') || (await listStudios(user.id))[0]?.id
    const requireMember = async () => studioId && (await isMember(studioId, user.id))

    if (req.method === 'GET' && pathname === '/api/state') {
      if (!(await requireMember())) return json(res, 403, { error: 'not a member of this studio' })
      return json(res, 200, await readState(studioId))
    }
    if (req.method === 'PUT' && pathname === '/api/state') {
      if (!(await requireMember())) return json(res, 403, { error: 'not a member of this studio' })
      const body = await readBody(req)
      if (!Array.isArray(body.sessions)) return json(res, 400, { error: 'sessions must be an array' })
      return json(res, 200, await writeState(studioId, body))
    }
    if (req.method === 'DELETE' && pathname === '/api/session') {
      if (!(await requireMember())) return json(res, 403, { error: 'not a member of this studio' })
      const id = url.searchParams.get('id')
      if (!id) return json(res, 400, { error: 'id required' })
      return json(res, 200, await deleteSession(studioId, id))
    }

    // ---- Revisions (gated to the process's studio) ---------------------
    if (req.method === 'GET' && pathname === '/api/revisions') {
      const id = url.searchParams.get('session')
      if (!id) return json(res, 400, { error: 'session required' })
      const st = await sessionStudioId(id)
      if (!st || !await isMember(st, user.id)) return json(res, 403, { error: 'no access' })
      return json(res, 200, { revisions: await listRevisions(id) })
    }
    if (req.method === 'GET' && pathname === '/api/revision') {
      const rev = await getRevision(Number(url.searchParams.get('id')))
      if (!rev) return json(res, 404, { error: 'not found' })
      const st = await sessionStudioId(rev.id)
      if (!st || !await isMember(st, user.id)) return json(res, 403, { error: 'no access' })
      return json(res, 200, rev)
    }

    if (req.method === 'GET' && pathname === '/api/health') {
      return json(res, 200, { ok: true, db: DB_FILE, store: STORE_KIND })
    }
    return false
  } catch (e) {
    return json(res, 500, { error: String(e?.message || e) })
  }

}
