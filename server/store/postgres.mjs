// Postgres store (Supabase, Neon, Railway Postgres — any Postgres).
//
// A faithful port of the SQLite store: same tables, same semantics, same function
// signatures, so `server/api.mjs` cannot tell the difference. The two live side by
// side and `store/index.mjs` picks one from DATABASE_URL, which is what makes the
// switch reversible — flip the variable and you're back on SQLite.
//
// Differences that matter, and why:
//   · Everything is async (the network is). The SQLite store is async too, purely
//     so the interface is identical.
//   · Session JSON stays TEXT, exactly as in SQLite. It could be jsonb, but TEXT
//     round-trips byte-for-byte, which is what a migration wants — no surprise
//     key reordering or numeric coercion in data the app parses itself.
//   · Supabase requires TLS. `ssl: { rejectUnauthorized: false }` matches what
//     their pooler expects; it encrypts without pinning their CA.

import pg from 'pg'
import { randomUUID } from 'node:crypto'

const { Pool } = pg

const url = process.env.DATABASE_URL
export const DB_FILE = url ? `postgres:${(() => { try { return new URL(url).host } catch { return 'configured' } })()}` : 'postgres'

const pool = new Pool({
  connectionString: url,
  // Managed Postgres always terminates TLS; local dev against plain Postgres won't.
  ssl: /sslmode=disable/.test(url || '') ? false : { rejectUnauthorized: false },
  max: 8,
  idleTimeoutMillis: 30_000,
})

const q = (text, params) => pool.query(text, params)
const one = async (text, params) => (await q(text, params)).rows[0] || null
const all = async (text, params) => (await q(text, params)).rows

const now = () => new Date().toISOString()
const uid = (p) => `${p}_${randomUUID().slice(0, 12)}`
const KEEP_REVISIONS = 40

// ---- Schema ---------------------------------------------------------------
export async function init() {
  await q(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         text PRIMARY KEY,
      studio_id  text,
      title      text NOT NULL DEFAULT '',
      ord        integer NOT NULL DEFAULT 0,
      data       text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key   text PRIMARY KEY,
      value text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revisions (
      id         bigserial PRIMARY KEY,
      session_id text NOT NULL,
      title      text NOT NULL DEFAULT '',
      data       text NOT NULL,
      saved_at   text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_revisions_session ON revisions(session_id, id DESC);

    CREATE TABLE IF NOT EXISTS users (
      id         text PRIMARY KEY,
      email      text UNIQUE NOT NULL,
      name       text NOT NULL DEFAULT '',
      avatar     text NOT NULL DEFAULT '',
      created_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS studios (
      id         text PRIMARY KEY,
      name       text NOT NULL DEFAULT 'Studio',
      created_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memberships (
      studio_id  text NOT NULL,
      user_id    text NOT NULL,
      role       text NOT NULL DEFAULT 'editor',
      created_at text NOT NULL,
      PRIMARY KEY (studio_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS invites (
      id         text PRIMARY KEY,
      studio_id  text NOT NULL,
      email      text NOT NULL,
      role       text NOT NULL DEFAULT 'editor',
      invited_by text NOT NULL DEFAULT '',
      created_at text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token      text PRIMARY KEY,
      user_id    text NOT NULL,
      created_at text NOT NULL
    );
  `)
}

// ---- Users ----------------------------------------------------------------
export async function upsertUser({ email, name = '', avatar = '' }) {
  const e = String(email).trim().toLowerCase()
  const existing = await one('SELECT * FROM users WHERE email = $1', [e])
  if (existing) {
    if ((name && name !== existing.name) || (avatar && avatar !== existing.avatar)) {
      await q('UPDATE users SET name = $1, avatar = $2 WHERE id = $3',
        [name || existing.name, avatar || existing.avatar, existing.id])
    }
    return await one('SELECT * FROM users WHERE id = $1', [existing.id])
  }
  const id = uid('u')
  await q('INSERT INTO users (id, email, name, avatar, created_at) VALUES ($1,$2,$3,$4,$5)',
    [id, e, name, avatar, now()])
  await claimInvites({ id, email: e })
  if (!(await listStudios(id)).length) await createStudio('My Studio', id)
  return await one('SELECT * FROM users WHERE id = $1', [id])
}

export const getUser = (id) => one('SELECT * FROM users WHERE id = $1', [id])
export const ensureDefaultUser = () => upsertUser({ email: 'you@local', name: 'You' })

// ---- Studios & membership -------------------------------------------------
export async function createStudio(name, ownerUserId) {
  const id = uid('st')
  await q('INSERT INTO studios (id, name, created_at) VALUES ($1,$2,$3)', [id, name || 'Studio', now()])
  await q(`INSERT INTO memberships (studio_id, user_id, role, created_at) VALUES ($1,$2,'owner',$3)
           ON CONFLICT DO NOTHING`, [id, ownerUserId, now()])
  return { id, name: name || 'Studio', role: 'owner' }
}

export async function listStudios(userId) {
  return all(
    `SELECT s.id, s.name, m.role,
            (SELECT COUNT(*)::int FROM sessions x WHERE x.studio_id = s.id) AS processes
     FROM studios s JOIN memberships m ON m.studio_id = s.id
     WHERE m.user_id = $1 ORDER BY s.created_at ASC`, [userId])
}

export const membership = (studioId, userId) =>
  one('SELECT * FROM memberships WHERE studio_id = $1 AND user_id = $2', [studioId, userId])
export const isMember = async (studioId, userId) => !!(await membership(studioId, userId))
export const listMembers = (studioId) =>
  all(`SELECT u.id, u.email, u.name, u.avatar, m.role FROM memberships m
       JOIN users u ON u.id = m.user_id WHERE m.studio_id = $1 ORDER BY m.created_at ASC`, [studioId])
export async function renameStudio(studioId, name) {
  await q('UPDATE studios SET name = $1 WHERE id = $2', [name, studioId])
  return { ok: true }
}

// ---- Invites --------------------------------------------------------------
export async function createInvite(studioId, email, role, invitedBy) {
  const e = String(email).trim().toLowerCase()
  const u = await one('SELECT * FROM users WHERE email = $1', [e])
  if (u) {
    await q(`INSERT INTO memberships (studio_id, user_id, role, created_at) VALUES ($1,$2,$3,$4)
             ON CONFLICT DO NOTHING`, [studioId, u.id, role || 'editor', now()])
    return { joined: true, email: e }
  }
  await q('INSERT INTO invites (id, studio_id, email, role, invited_by, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [uid('inv'), studioId, e, role || 'editor', invitedBy || '', now()])
  return { joined: false, email: e }
}

export const listInvites = (studioId) =>
  all('SELECT * FROM invites WHERE studio_id = $1 ORDER BY created_at ASC', [studioId])

export async function claimInvites(user) {
  const pending = await all('SELECT * FROM invites WHERE email = $1', [user.email])
  for (const inv of pending) {
    await q(`INSERT INTO memberships (studio_id, user_id, role, created_at) VALUES ($1,$2,$3,$4)
             ON CONFLICT DO NOTHING`, [inv.studio_id, user.id, inv.role, now()])
    await q('DELETE FROM invites WHERE email = $1 AND studio_id = $2', [user.email, inv.studio_id])
  }
  return pending.length
}

// ---- Auth sessions --------------------------------------------------------
export async function createAuthSession(userId) {
  const token = randomUUID() + randomUUID().slice(0, 8)
  await q('INSERT INTO auth_sessions (token, user_id, created_at) VALUES ($1,$2,$3)', [token, userId, now()])
  return token
}
export const userForToken = async (token) => {
  if (!token) return null
  const row = await one('SELECT user_id FROM auth_sessions WHERE token = $1', [token])
  return row ? getUser(row.user_id) : null
}
export const endAuthSession = async (token) => { if (token) await q('DELETE FROM auth_sessions WHERE token = $1', [token]) }

// ---- Studio-scoped state --------------------------------------------------
export async function readState(studioId) {
  const rows = await all('SELECT data FROM sessions WHERE studio_id = $1 ORDER BY ord ASC', [studioId])
  const sessions = rows.map((r) => JSON.parse(r.data))
  const meta = await one('SELECT value FROM meta WHERE key = $1', [`active:${studioId}`])
  const geomRow = await one('SELECT value FROM meta WHERE key = $1', ['geom'])
  return {
    sessions,
    activeId: meta?.value ?? sessions[0]?.id ?? null,
    geom: Number(geomRow?.value ?? 0) || undefined,
  }
}

// UPSERT-ONLY within the studio, and the WHERE guard means a client can never
// reassign a process that belongs to another studio — same rule as SQLite.
export async function writeState(studioId, { sessions = [], activeId, geom }) {
  const ts = now()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i]
      const json = JSON.stringify(s)
      const prev = (await client.query('SELECT data FROM sessions WHERE id = $1', [s.id])).rows[0]?.data
      await client.query(
        `INSERT INTO sessions (id, studio_id, title, ord, data, updated_at) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, ord = EXCLUDED.ord,
           data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
         WHERE sessions.studio_id = EXCLUDED.studio_id`,
        [s.id, studioId, s.title || '', i, json, ts])
      if (prev !== json) {
        await client.query('INSERT INTO revisions (session_id, title, data, saved_at) VALUES ($1,$2,$3,$4)',
          [s.id, s.title || '', json, ts])
        await client.query(
          `DELETE FROM revisions WHERE session_id = $1 AND id NOT IN
             (SELECT id FROM revisions WHERE session_id = $1 ORDER BY id DESC LIMIT $2)`,
          [s.id, KEEP_REVISIONS])
      }
    }
    if (activeId) {
      await client.query(`INSERT INTO meta (key, value) VALUES ($1,$2)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [`active:${studioId}`, String(activeId)])
    }
    if (geom != null) {
      await client.query(`INSERT INTO meta (key, value) VALUES ('geom',$1)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [String(geom)])
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  return { ok: true, sessions: sessions.length }
}

export async function deleteSession(studioId, id) {
  await q('DELETE FROM sessions WHERE id = $1 AND studio_id = $2', [id, studioId])
  return { ok: true, id }
}

export const sessionStudioId = async (id) =>
  (await one('SELECT studio_id FROM sessions WHERE id = $1', [id]))?.studio_id || null
export const listRevisions = (sessionId) =>
  all('SELECT id, title, saved_at FROM revisions WHERE session_id = $1 ORDER BY id DESC LIMIT 40', [sessionId])
export const getRevision = async (id) => {
  const row = await one('SELECT data FROM revisions WHERE id = $1', [id])
  return row ? JSON.parse(row.data) : null
}

// Sessions predating studios get folded into a default user's studio, exactly as
// the SQLite store does — so an imported database behaves the same.
export async function migrateOrphans() {
  const orphans = await all("SELECT id FROM sessions WHERE studio_id IS NULL OR studio_id = ''")
  if (!orphans.length) return null
  const owner = await ensureDefaultUser()
  const studio = (await listStudios(owner.id))[0] || (await createStudio('My Studio', owner.id))
  for (const row of orphans) await q('UPDATE sessions SET studio_id = $1 WHERE id = $2', [studio.id, row.id])
  return { studio: studio.id, user: owner.id, moved: orphans.length }
}
