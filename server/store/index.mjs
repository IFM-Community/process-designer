// Which store backs the app — chosen at startup, by environment only.
//
// The point of this indirection is that the switch is REVERSIBLE. Set
// DATABASE_URL and the app runs on Postgres (Supabase); unset it and the very
// same build falls back to the SQLite file. No code change, no redeploy of a
// different artefact — so if Postgres misbehaves, rolling back is one variable.
//
// Both modules export identical, all-async functions, so `server/api.mjs` never
// learns which one it is talking to.

const usePostgres = !!process.env.DATABASE_URL

const impl = usePostgres
  ? await import('./postgres.mjs')
  : await import('./sqlite.mjs')

console.log(`[store] ${usePostgres ? 'Postgres' : 'SQLite'} — ${impl.DB_FILE}`)

// Build the schema / run migrations before the first request is served.
await impl.init()

export const {
  DB_FILE,
  upsertUser, getUser, ensureDefaultUser,
  createStudio, getStudio, getStudioFull, listAllStudios, setStudioPassword, deleteStudio,
  getMetaValue, setMetaValue, listStudios, membership, isMember, listMembers, renameStudio,
  createInvite, listInvites, claimInvites,
  createAuthSession, userForToken, endAuthSession,
  readState, writeState, deleteSession,
  sessionStudioId, listRevisions, getRevision,
} = impl

export const STORE_KIND = usePostgres ? 'postgres' : 'sqlite'
