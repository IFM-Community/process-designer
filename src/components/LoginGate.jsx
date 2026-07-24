import { useState } from 'react'

// The sign-in screen.
//
// This is the SCAFFOLD for auth: Google sign-in (and later MBZUAI/Entra SSO) will
// replace the email form with their button, but everything behind it — the studio
// you land in, the library you see — is already real. Signing in with an email
// creates or finds that user and drops them into their studios.
//
// "Continue as You" is the bridge for existing local data: everything built before
// multi-user lives in the default account's "My Studio", so this one click lands
// you exactly where your processes already are.

export default function LoginGate({ onLogin }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const go = async (e, n) => {
    const addr = (e ?? email).trim()
    if (!addr.includes('@')) { setErr('Enter a valid email address.'); return }
    setBusy(true); setErr(null)
    try { await onLogin(addr, (n ?? name).trim()) }
    catch (ex) { setErr(ex.message || 'Could not sign in.'); setBusy(false) }
  }

  return (
    <div className="pd-login">
      <div className="pd-login-card">
        <div className="pd-login-mark">◆</div>
        <h1>Process Designer</h1>
        <p className="pd-login-sub">Sign in to your studios.</p>

        <button className="pd-login-google" disabled title="Coming soon — needs a Google OAuth client">
          <span className="pd-login-g">G</span> Continue with Google
          <span className="pd-login-soon">soon</span>
        </button>

        <div className="pd-login-or"><span>or continue with email</span></div>

        <label className="pd-login-label">Email</label>
        <input
          className="pd-login-input"
          type="email"
          value={email}
          placeholder="you@mbzuai.ac.ae"
          autoFocus
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') go() }}
        />
        <label className="pd-login-label">Name <span>(optional)</span></label>
        <input
          className="pd-login-input"
          value={name}
          placeholder="Your name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') go() }}
        />

        {err && <div className="pd-login-err">{err}</div>}

        <button className="pd-login-go" onClick={() => go()} disabled={busy}>
          {busy ? 'Signing in…' : 'Continue'}
        </button>

        <button className="pd-login-you" onClick={() => go('you@local', 'You')} disabled={busy}>
          Continue as You <span>— open my existing library</span>
        </button>

        <p className="pd-login-note">
          Google sign-in is the interim login; MBZUAI SSO comes once IT registers the app.
          Email sign-in works today so studios and sharing can be used now.
        </p>
      </div>
    </div>
  )
}
