import { useEffect, useState } from 'react'
import { listWorkspaces, unlockWorkspace, createStudio, wsToken } from '../lib/store'

// The front door at `/` — a gallery of every workspace on the server.
//
// A workspace card shows only its name, size and whether it's locked; the
// CONTENTS stay behind the password. Clicking a locked workspace asks for its
// password once — the browser then holds an access token and future visits go
// straight in. Anyone can create their own workspace here and set a password on
// it, which is how other university teams get their own room without anyone
// administering accounts.

export default function WorkspaceGallery({ onEnter }) {
  const [list, setList] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [unlocking, setUnlocking] = useState(null) // { id, name } awaiting password
  const [password, setPassword] = useState('')
  const [pwError, setPwError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPw, setNewPw] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listWorkspaces().then(setList).catch((e) => setError(e.message || 'Could not load workspaces.'))
  }, [])

  const open = (ws) => {
    // Already unlocked in this browser (token on hand) → straight in. The server
    // still verifies the token, so a stale one just brings the prompt back.
    if (!ws.locked || wsToken(ws.id)) { onEnter(ws) } else { setPassword(''); setPwError(null); setUnlocking(ws) }
  }

  const submitUnlock = async () => {
    if (busy) return
    setBusy(true); setPwError(null)
    try {
      await unlockWorkspace(unlocking.id, password)
      const ws = unlocking
      setUnlocking(null)
      onEnter(ws)
    } catch {
      setPwError('Wrong password.')
    } finally {
      setBusy(false)
    }
  }

  const submitCreate = async () => {
    if (busy || !newName.trim()) return
    setBusy(true)
    try {
      const ws = await createStudio(newName.trim(), newPw || undefined)
      onEnter({ ...ws, locked: !!newPw })
    } catch (e) {
      alert(`Could not create the workspace: ${e.message || e}`)
      setBusy(false)
    }
  }

  return (
    <div className="pd-gallery">
      <div className="pd-gallery-inner">
        <header className="pd-gallery-head">
          <span className="pd-gallery-mark">◆</span>
          <h1>Process Designer</h1>
          <p>Pick your team's workspace, or create one.</p>
        </header>

        {error && <div className="pd-gallery-error">{error}</div>}
        {!list && !error && <div className="pd-gallery-loading">Loading workspaces…</div>}

        {list && (
          <div className="pd-gallery-grid">
            {list.map((ws) => (
              <button key={ws.id} className="pd-ws-card" onClick={() => open(ws)}>
                <span className="pd-ws-card-top">
                  <span className="pd-ws-card-ico">◆</span>
                  {ws.locked && <span className="pd-ws-card-lock" title="Password protected">🔒</span>}
                </span>
                <span className="pd-ws-card-name">{ws.name}</span>
                <span className="pd-ws-card-meta">
                  {ws.processes} process{ws.processes === 1 ? '' : 'es'}
                  {ws.locked ? ' · password protected' : ''}
                </span>
              </button>
            ))}

            <button className="pd-ws-card is-new" onClick={() => { setNewName(''); setNewPw(''); setCreating(true) }}>
              <span className="pd-ws-card-plus">＋</span>
              <span className="pd-ws-card-name">New workspace</span>
              <span className="pd-ws-card-meta">For your own team — set a password if you like</span>
            </button>
          </div>
        )}
      </div>

      {unlocking && (
        <div className="pd-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setUnlocking(null) }}>
          <div className="pd-modal is-mini" role="dialog" aria-modal="true">
            <h2>{unlocking.name}</h2>
            <p className="pd-modal-lead">This workspace is password protected.</p>
            <input
              className="pd-card-text"
              type="password"
              autoFocus
              value={password}
              placeholder="Workspace password"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitUnlock()
                if (e.key === 'Escape') setUnlocking(null)
              }}
            />
            {pwError && <div className="pd-login-err">{pwError}</div>}
            <div className="pd-modal-actions">
              <button className="pd-modal-ghost" onClick={() => setUnlocking(null)}>Cancel</button>
              <button className="pd-modal-go" disabled={busy || !password} onClick={submitUnlock}>
                {busy ? 'Checking…' : 'Enter'}
              </button>
            </div>
          </div>
        </div>
      )}

      {creating && (
        <div className="pd-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setCreating(false) }}>
          <div className="pd-modal is-mini" role="dialog" aria-modal="true">
            <h2>New workspace</h2>
            <label className="pd-modal-label">Name</label>
            <input
              className="pd-card-text"
              autoFocus
              value={newName}
              placeholder="e.g. Finance Team"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setCreating(false) }}
            />
            <label className="pd-modal-label">Password <span style={{ textTransform: 'none', fontWeight: 500 }}>(optional — empty means anyone with the link can enter)</span></label>
            <input
              className="pd-card-text"
              type="password"
              value={newPw}
              placeholder="Workspace password"
              onChange={(e) => setNewPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitCreate() }}
            />
            <div className="pd-modal-actions">
              <button className="pd-modal-ghost" onClick={() => setCreating(false)}>Cancel</button>
              <button className="pd-modal-go" disabled={busy || !newName.trim()} onClick={submitCreate}>
                {busy ? 'Creating…' : 'Create workspace'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// Full-page password gate for opening a locked share link cold (or after the
// password changed and the old token went stale).
export function UnlockScreen({ meta, onUnlocked, onBack }) {
  const [password, setPassword] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (busy || !password) return
    setBusy(true); setErr(null)
    try { await unlockWorkspace(meta.id, password); onUnlocked() }
    catch { setErr('Wrong password.'); setBusy(false) }
  }

  return (
    <div className="pd-gallery">
      <div className="pd-gallery-inner is-narrow">
        <header className="pd-gallery-head">
          <span className="pd-gallery-mark">◆</span>
          <h1>{meta.name}</h1>
          <p>This workspace is password protected.</p>
        </header>
        <div className="pd-unlock-box">
          <input
            className="pd-card-text"
            type="password"
            autoFocus
            value={password}
            placeholder="Workspace password"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          />
          {err && <div className="pd-login-err">{err}</div>}
          <button className="pd-modal-go" disabled={busy || !password} onClick={submit}>
            {busy ? 'Checking…' : 'Enter workspace'}
          </button>
          <button className="pd-gallery-back" onClick={onBack}>← All workspaces</button>
        </div>
      </div>
    </div>
  )
}
