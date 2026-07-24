// Persistence for process sessions.
//
// The database (server/db.mjs, SQLite on disk) is the real store: it survives a
// cleared browser, it can be copied or backed up like any file, and every save
// that changes a process also appends a revision.
//
// localStorage is kept as a MIRROR, not as the store. It makes first paint
// instant and, more importantly, means a save is never simply lost if the API is
// down — the work stays in the browser and is pushed to the database on the next
// successful save.

// The mirror is per-STUDIO — two studios are two libraries and must not bleed into
// each other. Keyed by studio id.
const mirrorKey = (studioId) => `pd.sessions.v2:${studioId || 'default'}`

export function readMirror(studioId) {
  try {
    const raw = JSON.parse(localStorage.getItem(mirrorKey(studioId)))
    if (raw?.sessions) return raw
  } catch {}
  return null
}

// `dirty` marks a mirror written by a local change that has NOT yet been confirmed
// saved to the database. It is the flag that fixes "withdraw comes back after a
// refresh": the DB save is debounced, so a fast refresh can beat it to disk, and
// on boot the app would otherwise adopt the stale DB and lose the change. When the
// mirror is dirty, the mirror is the newer copy and wins (see App boot).
export function writeMirror(studioId, state, { dirty = false } = {}) {
  try { localStorage.setItem(mirrorKey(studioId), JSON.stringify({ ...state, _dirty: dirty })) } catch {}
}

export const mirrorIsDirty = (studioId) => {
  try { return JSON.parse(localStorage.getItem(mirrorKey(studioId)))?._dirty === true } catch { return false }
}

// State reads/writes are scoped to a STUDIO, and a locked workspace also needs
// its access token — minted by /api/studio/unlock from the password, kept per
// workspace in this browser, and sent as a header on every call.
const studioQ = (studio) => (studio ? `?studio=${encodeURIComponent(studio)}` : '')

const tokKey = (id) => `pd.wstok.${id}`
export const wsToken = (id) => { try { return localStorage.getItem(tokKey(id)) || null } catch { return null } }
export const setWsToken = (id, t) => { try { t ? localStorage.setItem(tokKey(id), t) : localStorage.removeItem(tokKey(id)) } catch {} }
const authHeaders = (studio) => {
  const t = studio && wsToken(studio)
  return t ? { 'x-pd-token': t } : {}
}

export async function fetchState(studio) {
  const res = await fetch(`/api/state${studioQ(studio)}`, { headers: authHeaders(studio) })
  if (!res.ok) { const e = new Error(`API ${res.status}`); e.status = res.status; throw e }
  const ctype = res.headers.get('content-type') || ''
  if (!ctype.includes('json')) {
    // Vite's SPA fallback answered — the API isn't running behind the proxy.
    throw new Error('the local database API is not running (start it with `npm run dev`)')
  }
  return res.json()
}

export async function saveState(state, studio) {
  const res = await fetch(`/api/state${studioQ(studio)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders(studio) },
    body: JSON.stringify(state),
  })
  if (!res.ok) { const e = new Error(`API ${res.status}`); e.status = res.status; throw e }
  const ctype = res.headers.get('content-type') || ''
  if (!ctype.includes('json')) throw new Error('the local database API is not running')
  return res.json()
}

export async function deleteSessionOnServer(id, studio) {
  try { await fetch(`/api/session?id=${encodeURIComponent(id)}${studio ? `&studio=${encodeURIComponent(studio)}` : ''}`, { method: 'DELETE', headers: authHeaders(studio) }) } catch {}
}

// ---- Workspaces (link-shareable, no accounts) -----------------------------
const asJson = async (res) => { if (!res.ok) { const e = new Error(`API ${res.status}`); e.status = res.status; throw e } return res.json() }

// Create a new workspace, get back { id, name }. Its share link is /s/<id>.
// A password makes it LOCKED — the returned token is stored so the creator
// doesn't have to immediately unlock their own workspace.
export const createStudio = (name, password) =>
  fetch('/api/studios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) })
    .then(asJson).then((r) => { if (r.token) setWsToken(r.studio.id, r.token); return r.studio })

// The gallery: every workspace on the server (name/count/locked only).
export const listWorkspaces = () => fetch('/api/studios/list').then(asJson).then((r) => r.studios || [])

// Password → token, remembered for this browser. Throws on a wrong password.
export async function unlockWorkspace(id, password) {
  const r = await fetch('/api/studio/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, password }) }).then(asJson)
  setWsToken(id, r.token)
  return true
}

// Set / change / clear (empty) the password. Needs current access.
export async function setWorkspacePassword(id, password) {
  const r = await fetch('/api/studio/password', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(id) }, body: JSON.stringify({ id, password }) }).then(asJson)
  setWsToken(id, r.token)
  return true
}

export const deleteWorkspaceOnServer = (id) =>
  fetch(`/api/studio?studio=${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders(id) }).then(asJson)
// Metadata for a workspace you hold a link to: { id, name, processes }. 404 → gone.
export async function fetchStudio(id) {
  const res = await fetch(`/api/studio?id=${encodeURIComponent(id)}`)
  if (res.status === 404) return null
  return asJson(res)
}
export const renameStudioOnServer = (id, name) =>
  fetch('/api/studio/rename', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(id) }, body: JSON.stringify({ id, name }) }).then(asJson)

// The workspaces THIS BROWSER knows about — there are no accounts, so the browser
// remembers the ones you've created or opened a link to (like Excalidraw's recent
// rooms). Each is { id, name }.
const WS_KEY = 'pd.workspaces.v1'
export function knownWorkspaces() {
  try { return JSON.parse(localStorage.getItem(WS_KEY)) || [] } catch { return [] }
}
export function rememberWorkspace(ws) {
  if (!ws?.id) return
  const list = knownWorkspaces().filter((w) => w.id !== ws.id)
  list.unshift({ id: ws.id, name: ws.name || 'Workspace' })
  try { localStorage.setItem(WS_KEY, JSON.stringify(list)) } catch {}
}
export function forgetWorkspace(id) {
  try { localStorage.setItem(WS_KEY, JSON.stringify(knownWorkspaces().filter((w) => w.id !== id))) } catch {}
}

// Which workspace was open last, so a bare reload lands where you left off.
export const readLastStudio = () => { try { return localStorage.getItem('pd.studio') || null } catch { return null } }
export const writeLastStudio = (id) => { try { localStorage.setItem('pd.studio', id || '') } catch {} }

export async function fetchRevisions(sessionId) {
  const res = await fetch(`/api/revisions?session=${encodeURIComponent(sessionId)}`)
  if (!res.ok) return []
  return (await res.json()).revisions || []
}

export async function fetchRevision(id) {
  const res = await fetch(`/api/revision?id=${id}`)
  if (!res.ok) return null
  return res.json()
}
