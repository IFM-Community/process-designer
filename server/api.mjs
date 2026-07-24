// API in front of the store (SQLite or Postgres).
//
// LINK-SHAREABLE, NO ACCOUNTS. There is no login: a workspace is reached by its
// id, which lives in its share link. Possession of the link is the access grant —
// like an unlisted document. The old cookie/user/membership machinery is gone;
// the users/memberships/invites tables still exist in the store but are unused by
// this API (kept so an SSO layer can be added later without a migration).

import {
  DB_FILE, STORE_KIND, readState, writeState, deleteSession, listRevisions, getRevision,
  createStudio, getStudio, renameStudio, sessionStudioId,
} from './store/index.mjs'

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

    // ---- Workspaces (link-shareable, no accounts) ----------------------
    // The access model is CAPABILITY-BASED: knowing a workspace's id (which lives
    // in its share link) is the grant. There is no login and no membership check —
    // like an unlisted document, anyone with the link is in. Ids are random, so
    // they aren't guessable; this is the right trust level for internal process
    // docs shared within a team.
    if (req.method === 'POST' && pathname === '/api/studios') {
      const { name } = await readBody(req)
      const studio = await createStudio((name || '').trim() || 'New workspace') // ownerless
      return json(res, 200, { studio })
    }
    // Metadata for a workspace you hold a link to — name + process count.
    if (req.method === 'GET' && pathname === '/api/studio') {
      const id = url.searchParams.get('id')
      if (!id) return json(res, 400, { error: 'id required' })
      const s = await getStudio(id)
      return s ? json(res, 200, s) : json(res, 404, { error: 'workspace not found' })
    }
    if (req.method === 'POST' && pathname === '/api/studio/rename') {
      const { id, name } = await readBody(req)
      if (!id) return json(res, 400, { error: 'id required' })
      if (!(await getStudio(id))) return json(res, 404, { error: 'workspace not found' })
      await renameStudio(id, (name || '').trim() || 'Workspace')
      return json(res, 200, await getStudio(id))
    }

    // ---- Studio-scoped process state -----------------------------------
    // `studio` must be named and must exist — that's the whole access check.
    const studioId = url.searchParams.get('studio')
    const studioExists = async () => studioId && (await getStudio(studioId))

    if (req.method === 'GET' && pathname === '/api/state') {
      if (!(await studioExists())) return json(res, 404, { error: 'workspace not found' })
      return json(res, 200, await readState(studioId))
    }
    if (req.method === 'PUT' && pathname === '/api/state') {
      if (!(await studioExists())) return json(res, 404, { error: 'workspace not found' })
      const body = await readBody(req)
      if (!Array.isArray(body.sessions)) return json(res, 400, { error: 'sessions must be an array' })
      return json(res, 200, await writeState(studioId, body))
    }
    if (req.method === 'DELETE' && pathname === '/api/session') {
      if (!(await studioExists())) return json(res, 404, { error: 'workspace not found' })
      const id = url.searchParams.get('id')
      if (!id) return json(res, 400, { error: 'id required' })
      return json(res, 200, await deleteSession(studioId, id))
    }

    // ---- Revisions (gated to the process's own studio) -----------------
    if (req.method === 'GET' && pathname === '/api/revisions') {
      const id = url.searchParams.get('session')
      if (!id) return json(res, 400, { error: 'session required' })
      const st = await sessionStudioId(id)
      if (!st || st !== studioId) return json(res, 403, { error: 'no access' })
      return json(res, 200, { revisions: await listRevisions(id) })
    }
    if (req.method === 'GET' && pathname === '/api/revision') {
      const rev = await getRevision(Number(url.searchParams.get('id')))
      if (!rev) return json(res, 404, { error: 'not found' })
      const st = await sessionStudioId(rev.id)
      if (!st || st !== studioId) return json(res, 403, { error: 'no access' })
      return json(res, 200, rev)
    }

    return false
  } catch (e) {
    return json(res, 500, { error: String(e?.message || e) })
  }

}
