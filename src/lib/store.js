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

// State reads/writes are scoped to a STUDIO. `studio` is optional — when omitted
// the server falls back to the caller's first studio (keeps the old single-user
// path working), so passing it is additive, not a breaking change.
const studioQ = (studio) => (studio ? `?studio=${encodeURIComponent(studio)}` : '')

export async function fetchState(studio) {
  const res = await fetch(`/api/state${studioQ(studio)}`)
  if (!res.ok) throw new Error(`API ${res.status}`)
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const ctype = res.headers.get('content-type') || ''
  if (!ctype.includes('json')) throw new Error('the local database API is not running')
  return res.json()
}

export async function deleteSessionOnServer(id, studio) {
  try { await fetch(`/api/session?id=${encodeURIComponent(id)}${studio ? `&studio=${encodeURIComponent(studio)}` : ''}`, { method: 'DELETE' }) } catch {}
}

// ---- Auth + studios -------------------------------------------------------
const asJson = async (res) => { if (!res.ok) { const e = new Error(`API ${res.status}`); e.status = res.status; throw e } return res.json() }

// Who am I? 401 → not signed in (show the login gate).
export async function fetchMe() {
  const res = await fetch('/api/me')
  if (res.status === 401) return null
  return asJson(res)
}
export const login = (email, name) =>
  fetch('/api/auth/mock-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, name }) }).then(asJson)
export const logout = () => fetch('/api/auth/logout', { method: 'POST' }).then(asJson)
export const createStudio = (name) =>
  fetch('/api/studios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).then(asJson)
export const fetchMembers = (studioId) =>
  fetch(`/api/studios/${encodeURIComponent(studioId)}/members`).then(asJson).then((r) => r.members || [])
export const inviteToStudio = (studioId, email, role) =>
  fetch(`/api/studios/${encodeURIComponent(studioId)}/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role }) }).then(asJson)
export const renameStudioOnServer = (studioId, name) =>
  fetch(`/api/studios/${encodeURIComponent(studioId)}/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).then(asJson)

// Which studio the user last had open, so a reload lands where they left off.
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
