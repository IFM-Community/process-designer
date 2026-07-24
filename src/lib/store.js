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

// ---- Workspaces (link-shareable, no accounts) -----------------------------
const asJson = async (res) => { if (!res.ok) { const e = new Error(`API ${res.status}`); e.status = res.status; throw e } return res.json() }

// Create a new workspace, get back { id, name }. Its share link is /s/<id>.
export const createStudio = (name) =>
  fetch('/api/studios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    .then(asJson).then((r) => r.studio)
// Metadata for a workspace you hold a link to: { id, name, processes }. 404 → gone.
export async function fetchStudio(id) {
  const res = await fetch(`/api/studio?id=${encodeURIComponent(id)}`)
  if (res.status === 404) return null
  return asJson(res)
}
export const renameStudioOnServer = (id, name) =>
  fetch('/api/studio/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }) }).then(asJson)

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
