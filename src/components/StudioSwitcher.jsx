import { useEffect, useRef, useState } from 'react'
import { fetchMembers, inviteToStudio } from '../lib/store'
import { createPortal } from 'react-dom'

// The studio switcher — which shared workspace you're in, who else is in it, and
// how to bring someone in.
//
// A studio is the unit of sharing: the library you see is the studio's, and
// inviting someone by email lets them into exactly this studio (they join the
// moment they sign in). Switching studios switches your whole library, which is
// why it lives at the top level next to Studio/Library, not inside a process.

export default function StudioSwitcher({ user, studios, currentId, onSwitch, onCreate, onLogout, onRename }) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState(null) // null | 'members'
  const [members, setMembers] = useState(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('editor')
  const [msg, setMsg] = useState(null)
  const ref = useRef(null)

  const current = studios.find((s) => s.id === currentId) || studios[0]

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setPanel(null) } }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const openMembers = async () => {
    setPanel('members'); setMembers(null); setMsg(null)
    try { setMembers(await fetchMembers(current.id)) } catch { setMembers([]) }
  }

  const invite = async () => {
    const email = inviteEmail.trim()
    if (!email.includes('@')) { setMsg({ err: true, text: 'Enter a valid email.' }); return }
    try {
      const r = await inviteToStudio(current.id, email, inviteRole)
      setInviteEmail('')
      // Be honest: NO email is sent (there's no mail server wired). The invite is a
      // pre-authorisation — the person is in the moment they sign in with this email.
      setMsg({ text: r.joined
        ? `${email} already has an account and is now in the studio.`
        : `${email} is invited. No email is sent — ask them to sign in with this address and they'll be in automatically.` })
      setMembers(r.members || (await fetchMembers(current.id)))
    } catch (e) { setMsg({ err: true, text: e.message || 'Could not invite.' }) }
  }

  const create = async () => {
    const name = prompt('Name the new studio')
    if (name?.trim()) onCreate(name.trim())
    setOpen(false)
  }

  const rename = async () => {
    const name = prompt('Rename studio', current?.name || '')
    if (name?.trim() && name.trim() !== current?.name) await onRename(current.id, name.trim())
    setOpen(false)
  }

  const btnRef = useRef(null)
  const [anchor, setAnchor] = useState(null)
  const toggle = () => {
    if (!open && btnRef.current) setAnchor(btnRef.current.getBoundingClientRect())
    setOpen((v) => !v); setPanel(null)
  }

  return (
    <div className="pd-studios" ref={ref}>
      <button ref={btnRef} className="pd-studio-btn" onClick={toggle} title="Switch studio, invite people">
        <span className="pd-studio-ico">◆</span>
        <span className="pd-studio-name">{current?.name || 'Studio'}</span>
        <span className="pd-studio-caret">▾</span>
      </button>

      {open && anchor && createPortal(
        <div
          className="pd-studio-menu"
          style={{ position: 'fixed', top: anchor.bottom + 6, left: anchor.left }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {panel === 'members' ? (
            <>
              <button className="pd-studio-back" onClick={() => setPanel(null)}>← {current.name}</button>
              <div className="pd-studio-sec">People in this studio</div>
              <div className="pd-studio-members">
                {members === null ? <div className="pd-studio-dim">Loading…</div>
                  : members.length === 0 ? <div className="pd-studio-dim">Just you.</div>
                  : members.map((m) => (
                    <div className="pd-studio-member" key={m.id}>
                      <span className="pd-studio-avatar">{(m.name || m.email)[0]?.toUpperCase()}</span>
                      <span className="pd-studio-mtext">
                        <strong>{m.name || m.email}</strong>
                        <span>{m.email} · {m.role}</span>
                      </span>
                    </div>
                  ))}
              </div>
              <div className="pd-studio-sec">Invite by email</div>
              <div className="pd-studio-invite">
                <input
                  value={inviteEmail}
                  placeholder="name@mbzuai.ac.ae"
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') invite() }}
                />
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button onClick={invite}>Invite</button>
              </div>
              <div className="pd-studio-hint">No email is sent yet — the person just signs in with this address and they're in.</div>
              {msg && <div className={`pd-studio-msg ${msg.err ? 'is-err' : ''}`}>{msg.text}</div>}
            </>
          ) : (
            <>
              <div className="pd-studio-sec">Your studios</div>
              {studios.map((s) => (
                <button
                  key={s.id}
                  className={`pd-studio-item ${s.id === currentId ? 'is-on' : ''}`}
                  onClick={() => { onSwitch(s.id); setOpen(false) }}
                >
                  <span className="pd-studio-ico sm">◆</span>
                  <span className="pd-studio-itext"><strong>{s.name}</strong><span>{s.processes ?? 0} processes · {s.role}</span></span>
                  {s.id === currentId && <span className="pd-studio-check">✓</span>}
                </button>
              ))}
              <div className="pd-menu-sep" />
              <button className="pd-studio-act" onClick={openMembers}>People &amp; invites…</button>
              {current?.role === 'owner' && (
                <button className="pd-studio-act" onClick={rename}>Rename studio…</button>
              )}
              <button className="pd-studio-act" onClick={create}>＋ New studio…</button>
              <div className="pd-menu-sep" />
              <div className="pd-studio-who">
                <span className="pd-studio-avatar">{(user?.name || user?.email || '?')[0]?.toUpperCase()}</span>
                <span className="pd-studio-mtext"><strong>{user?.name || 'You'}</strong><span>{user?.email}</span></span>
              </div>
              <button className="pd-studio-act is-danger" onClick={onLogout}>Sign out</button>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
