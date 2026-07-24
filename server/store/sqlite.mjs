// SQLite store (the default, and the rollback target).
//
// Logic unchanged from the original single-file store; the exported functions are
// declared `async` ONLY so this and the Postgres store present the same interface
// to server/api.mjs. SQLite itself is synchronous — the awaits cost nothing.
//
// Original header follows.
// Local SQLite store.
//
// Uses node:sqlite, built into Node 22.5+ — no native module to compile, no
// dependency to install, and the whole database is one file you can copy, back
// up or inspect with any SQLite tool. The file lives at data/process-designer.db.
//
// The store went from single-user to MULTI-TENANT: processes belong to a STUDIO
// (a shared workspace), users are members of studios, and everything is scoped by
// studio. A person's "library" is the union of the studios they belong to. This
// is the foundation the Google sign-in (and later Entra SSO) plugs into — the auth
// layer only has to answer "who is this user", and the studio model does the rest.

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const FILE = resolve(process.cwd(), 'data/process-designer.db')
mkdirSync(dirname(FILE), { recursive: true })

export const db = new DatabaseSync(FILE)
export const DB_FILE = FILE

const now = () => new Date().toISOString()
const uid = (p) => `${p}_${randomUUID().slice(0, 12)}`

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '',
    ord        INTEGER NOT NULL DEFAULT 0,
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS revisions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    data       TEXT NOT NULL,
    saved_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_revisions_session ON revisions(session_id, id DESC);

  -- ---- Multi-tenant tables -------------------------------------------------
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    email      TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL DEFAULT '',
    avatar     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS studios (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT 'Studio',
    created_at TEXT NOT NULL
  );

  -- Who belongs to which studio, and what they can do. owner|editor|viewer.
  CREATE TABLE IF NOT EXISTS memberships (
    studio_id  TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'editor',
    created_at TEXT NOT NULL,
    PRIMARY KEY (studio_id, user_id)
  );

  -- An invite is by EMAIL, so you can invite someone before they've ever signed
  -- in. The moment that email signs in, the invite becomes a membership.
  CREATE TABLE IF NOT EXISTS invites (
    id         TEXT PRIMARY KEY,
    studio_id  TEXT NOT NULL,
    email      TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'editor',
    invited_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);

  -- Opaque login sessions. Google sign-in (and Entra later) create one of these
  -- after verifying the user; the browser only ever holds this token, never the
  -- provider's tokens.
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`)

// sessions predates studios, so add the column if an older DB is missing it.
const hasStudioCol = db.prepare("SELECT 1 FROM pragma_table_info('sessions') WHERE name = 'studio_id'").get()
if (!hasStudioCol) db.exec('ALTER TABLE sessions ADD COLUMN studio_id TEXT')
// Workspace passwords arrived after the table existed.
const hasPwCol = db.prepare("SELECT 1 FROM pragma_table_info('studios') WHERE name = 'password_hash'").get()
if (!hasPwCol) db.exec('ALTER TABLE studios ADD COLUMN password_hash TEXT')

const KEEP_REVISIONS = 40

const q = {
  // sessions scoped by studio
  studioSessions: db.prepare('SELECT id, data FROM sessions WHERE studio_id = ? ORDER BY ord ASC'),
  orphanSessions: db.prepare("SELECT id FROM sessions WHERE studio_id IS NULL OR studio_id = ''"),
  assignStudio: db.prepare('UPDATE sessions SET studio_id = ? WHERE id = ?'),
  sessionStudio: db.prepare('SELECT studio_id FROM sessions WHERE id = ?'),
  upsert: db.prepare(
    `INSERT INTO sessions (id, studio_id, title, ord, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, ord = excluded.ord,
       data = excluded.data, updated_at = excluded.updated_at
       WHERE sessions.studio_id = excluded.studio_id`, // never let a save reassign another studio's process
  ),
  deleteSession: db.prepare('DELETE FROM sessions WHERE id = ? AND studio_id = ?'),
  currentData: db.prepare('SELECT data FROM sessions WHERE id = ?'),
  addRevision: db.prepare('INSERT INTO revisions (session_id, title, data, saved_at) VALUES (?, ?, ?, ?)'),
  trimRevisions: db.prepare(
    `DELETE FROM revisions WHERE session_id = ? AND id NOT IN
       (SELECT id FROM revisions WHERE session_id = ? ORDER BY id DESC LIMIT ?)`,
  ),
  getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
  setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  listRevisions: db.prepare('SELECT id, title, saved_at FROM revisions WHERE session_id = ? ORDER BY id DESC LIMIT 40'),
  getRevision: db.prepare('SELECT data FROM revisions WHERE id = ?'),

  insUser: db.prepare('INSERT INTO users (id, email, name, avatar, created_at) VALUES (?, ?, ?, ?, ?)'),
  updUser: db.prepare('UPDATE users SET name = ?, avatar = ? WHERE id = ?'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),

  insStudio: db.prepare('INSERT INTO studios (id, name, created_at) VALUES (?, ?, ?)'),
  studioById: db.prepare('SELECT * FROM studios WHERE id = ?'),
  allStudios: db.prepare('SELECT id, name, password_hash, created_at FROM studios ORDER BY created_at ASC'),
  setStudioPw: db.prepare('UPDATE studios SET password_hash = ? WHERE id = ?'),
  delStudio: db.prepare('DELETE FROM studios WHERE id = ?'),
  delStudioSessions: db.prepare('DELETE FROM sessions WHERE studio_id = ?'),
  renameStudio: db.prepare('UPDATE studios SET name = ? WHERE id = ?'),

  insMember: db.prepare('INSERT OR IGNORE INTO memberships (studio_id, user_id, role, created_at) VALUES (?, ?, ?, ?)'),
  member: db.prepare('SELECT * FROM memberships WHERE studio_id = ? AND user_id = ?'),
  studiosForUser: db.prepare(
    `SELECT s.id, s.name, m.role FROM studios s
     JOIN memberships m ON m.studio_id = s.id
     WHERE m.user_id = ? ORDER BY s.created_at ASC`,
  ),
  membersOf: db.prepare(
    `SELECT u.id, u.email, u.name, u.avatar, m.role FROM memberships m
     JOIN users u ON u.id = m.user_id WHERE m.studio_id = ? ORDER BY m.created_at ASC`,
  ),
  countProcesses: db.prepare('SELECT COUNT(*) c FROM sessions WHERE studio_id = ?'),

  insInvite: db.prepare('INSERT INTO invites (id, studio_id, email, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  invitesForEmail: db.prepare('SELECT * FROM invites WHERE email = ?'),
  invitesForStudio: db.prepare('SELECT * FROM invites WHERE studio_id = ? ORDER BY created_at ASC'),
  delInvite: db.prepare('DELETE FROM invites WHERE id = ?'),
  delInvitesForEmailStudio: db.prepare('DELETE FROM invites WHERE email = ? AND studio_id = ?'),

  insAuth: db.prepare('INSERT INTO auth_sessions (token, user_id, created_at) VALUES (?, ?, ?)'),
  authUser: db.prepare('SELECT user_id FROM auth_sessions WHERE token = ?'),
  delAuth: db.prepare('DELETE FROM auth_sessions WHERE token = ?'),
}

// ---- Users ----------------------------------------------------------------

export async function upsertUser({ email, name = '', avatar = '' }) {
  const e = String(email).trim().toLowerCase()
  const existing = q.userByEmail.get(e)
  if (existing) {
    if ((name && name !== existing.name) || (avatar && avatar !== existing.avatar)) {
      q.updUser.run(name || existing.name, avatar || existing.avatar, existing.id)
    }
    return q.userById.get(existing.id)
  }
  const id = uid('u')
  q.insUser.run(id, e, name, avatar, now())
  // First time we see this email: pull in any studios they were invited to, and
  // give them a personal studio to land in.
  claimInvites({ id, email: e })
  if (!q.studiosForUser.all(id).length) createStudio('My Studio', id)
  return q.userById.get(id)
}

export const getUser = async (id) => q.userById.get(id) || null

// The single-user fallback while the login UI is being built: everything runs as
// this user (and their default studio) unless PD_REQUIRE_AUTH forces real sign-in.
// Google/Entra will make this unnecessary; until then it keeps the app working
// exactly as before, on top of the multi-tenant tables.
export const ensureDefaultUser = async () => upsertUser({ email: 'you@local', name: 'You' })

// ---- Studios & membership -------------------------------------------------

export async function createStudio(name, ownerUserId) {
  // ownerUserId is optional now: the link-shareable model has no accounts, so a
  // workspace is created ownerless. When a userId IS given (the old account flow),
  // a membership is still recorded, so nothing that relied on it breaks.
  const id = uid('st')
  q.insStudio.run(id, name || 'Studio', now())
  if (ownerUserId) q.insMember.run(id, ownerUserId, 'owner', now())
  return { id, name: name || 'Studio', role: 'owner' }
}

// A workspace's public metadata, looked up by id — this is what the switcher shows
// for a link you hold. Existence of the id IS the access grant.
export const getStudio = async (id) => {
  const s = q.studioById.get(id)
  return s ? { id: s.id, name: s.name, processes: q.countProcesses.get(id).c, locked: !!s.password_hash } : null
}

// Internal (never serialised to a client): includes the password hash.
export const getStudioFull = async (id) => q.studioById.get(id) || null

// The gallery: every workspace, oldest first, with a lock flag — names and counts
// only — the hash never leaves the server.
export const listAllStudios = async () =>
  q.allStudios.all().map((s) => ({
    id: s.id, name: s.name, processes: q.countProcesses.get(s.id).c, locked: !!s.password_hash,
  }))

export const setStudioPassword = async (id, hash) => { q.setStudioPw.run(hash || null, id); return { ok: true } }

// Removes the workspace and its processes. Revisions are left behind on purpose —
// they're the only undo for a workspace deleted by mistake.
export const deleteStudio = async (id) => {
  q.delStudioSessions.run(id)
  q.delStudio.run(id)
  return { ok: true }
}

export const getMetaValue = async (key) => q.getMeta.get(key)?.value ?? null
export const setMetaValue = async (key, value) => { q.setMeta.run(key, String(value)); return { ok: true } }

export const listStudios = async (userId) =>
  q.studiosForUser.all(userId).map((s) => ({ ...s, processes: q.countProcesses.get(s.id).c }))

export const membership = async (studioId, userId) => q.member.get(studioId, userId) || null
export const isMember = async (studioId, userId) => !!q.member.get(studioId, userId)
export const listMembers = async (studioId) => q.membersOf.all(studioId)
export async function renameStudio(studioId, name) { q.renameStudio.run(name, studioId); return { ok: true } }

// ---- Invites --------------------------------------------------------------

export async function createInvite(studioId, email, role, invitedBy) {
  const e = String(email).trim().toLowerCase()
  // If they already have an account, join them straight away — no dangling invite.
  const u = q.userByEmail.get(e)
  if (u) { q.insMember.run(studioId, u.id, role || 'editor', now()); return { joined: true, email: e } }
  const id = uid('inv')
  q.insInvite.run(id, studioId, e, role || 'editor', invitedBy || '', now())
  return { joined: false, email: e }
}

export const listInvites = async (studioId) => q.invitesForStudio.all(studioId)

// When a user signs in, turn every invite addressed to their email into a real
// membership. This is what makes "invite by email, they join on first sign-in" work.
export async function claimInvites(user) {
  const pending = q.invitesForEmail.all(user.email)
  for (const inv of pending) {
    q.insMember.run(inv.studio_id, user.id, inv.role, now())
    q.delInvitesForEmailStudio.run(user.email, inv.studio_id)
  }
  return pending.length
}

// ---- Auth sessions --------------------------------------------------------

export async function createAuthSession(userId) {
  const token = randomUUID() + randomUUID().slice(0, 8)
  q.insAuth.run(token, userId, now())
  return token
}
export const userForToken = async (token) => {
  const row = token && q.authUser.get(token)
  return row ? q.userById.get(row.user_id) : null
}
export const endAuthSession = async (token) => { if (token) q.delAuth.run(token) }

// ---- Studio-scoped state --------------------------------------------------

export async function readState(studioId) {
  const sessions = q.studioSessions.all(studioId).map((r) => JSON.parse(r.data))
  const activeId = q.getMeta.get(`active:${studioId}`)?.value ?? sessions[0]?.id ?? null
  const geom = Number(q.getMeta.get('geom')?.value ?? 0) || undefined
  return { sessions, activeId, geom }
}

// UPSERT-ONLY within the studio: a save never removes a process it wasn't told
// about (two members' tabs both autosave the whole library), and the ON CONFLICT
// guard means a client can never reassign a process that belongs elsewhere.
export async function writeState(studioId, { sessions = [], activeId, geom }) {
  const ts = now()
  db.prepare('BEGIN').run()
  try {
    sessions.forEach((s, i) => {
      const json = JSON.stringify(s)
      const prev = q.currentData.get(s.id)?.data
      q.upsert.run(s.id, studioId, s.title || '', i, json, ts)
      if (prev !== json) {
        q.addRevision.run(s.id, s.title || '', json, ts)
        q.trimRevisions.run(s.id, s.id, KEEP_REVISIONS)
      }
    })
    if (activeId) q.setMeta.run(`active:${studioId}`, String(activeId))
    if (geom != null) q.setMeta.run('geom', String(geom))
    db.prepare('COMMIT').run()
  } catch (e) {
    db.prepare('ROLLBACK').run()
    throw e
  }
  return { ok: true, sessions: sessions.length }
}

export async function deleteSession(studioId, id) {
  q.deleteSession.run(id, studioId)
  return { ok: true, id }
}

// Only serve revisions for a process that lives in the caller's studio.
export const sessionStudioId = async (id) => q.sessionStudio.get(id)?.studio_id || null
export const listRevisions = async (sessionId) => q.listRevisions.all(sessionId)
export const getRevision = async (id) => {
  const row = q.getRevision.get(id)
  return row ? JSON.parse(row.data) : null
}

// ---- One-time migration ---------------------------------------------------
// An existing single-user database has sessions with no studio. Fold them all
// into a default user + "My Studio" so nothing built before multi-tenancy is lost
// and the owner keeps working exactly as before, now inside a studio.
export async function migrateOrphans() {
  const orphans = q.orphanSessions.all()
  if (!orphans.length) return null
  const owner = upsertUser({ email: 'you@local', name: 'You' })
  const studio = q.studiosForUser.all(owner.id)[0] || createStudio('My Studio', owner.id)
  for (const row of orphans) q.assignStudio.run(studio.id, row.id)
  return { studio: studio.id, user: owner.id, moved: orphans.length }
}
// init() exists so both stores share a lifecycle; SQLite builds its schema at
// import time, so there is nothing more to do here.
export async function init() { await migrateOrphans() }
