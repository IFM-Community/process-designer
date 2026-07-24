import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// The workspace switcher — which shared workspace you're in, and how to bring
// someone into it.
//
// There are NO accounts. A workspace is shared by its LINK: send someone the
// link, they open it, they're in — the same model as an unlisted document. So the
// key action here is "Copy link", not "invite by email". This browser remembers
// the workspaces you've opened (there's no server-side "your workspaces" without
// accounts), and switching workspaces changes the address bar to that workspace's
// link.

export default function StudioSwitcher({ workspaces = [], currentId, currentName, onOpen, onCreate, onRename }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const wrapRef = useRef(null)
  const btnRef = useRef(null)
  const [anchor, setAnchor] = useState(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const toggle = () => {
    if (!open && btnRef.current) setAnchor(btnRef.current.getBoundingClientRect())
    setOpen((v) => !v)
  }

  const shareLink = `${window.location.origin}/s/${currentId}`
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard blocked (e.g. non-HTTPS): fall back to a prompt to copy by hand.
      window.prompt('Copy this workspace link:', shareLink)
    }
  }

  const create = () => {
    const name = window.prompt('Name the new workspace')
    if (name?.trim()) onCreate(name.trim())
    setOpen(false)
  }
  const rename = () => {
    const name = window.prompt('Rename workspace', currentName || '')
    if (name?.trim() && name.trim() !== currentName) onRename(currentId, name.trim())
    setOpen(false)
  }

  return (
    <div className="pd-studios" ref={wrapRef}>
      <button ref={btnRef} className="pd-studio-btn" onClick={toggle} title="Switch workspace, copy the share link">
        <span className="pd-studio-ico">◆</span>
        <span className="pd-studio-name">{currentName || 'Workspace'}</span>
        <span className="pd-studio-caret">▾</span>
      </button>

      {open && anchor && createPortal(
        <div
          className="pd-studio-menu"
          style={{ position: 'fixed', top: anchor.bottom + 6, left: anchor.left }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Share is the headline action — this is how anyone else gets in. */}
          <button className="pd-studio-share" onClick={copyLink}>
            <span className="pd-studio-share-ico">🔗</span>
            <span className="pd-studio-share-text">
              <strong>{copied ? 'Link copied!' : 'Copy share link'}</strong>
              <span>Anyone with the link can open this workspace</span>
            </span>
          </button>

          <div className="pd-menu-sep" />
          <div className="pd-studio-sec">Your workspaces</div>
          {workspaces.map((w) => (
            <button
              key={w.id}
              className={`pd-studio-item ${w.id === currentId ? 'is-on' : ''}`}
              onClick={() => { onOpen(w.id); setOpen(false) }}
            >
              <span className="pd-studio-ico sm">◆</span>
              <span className="pd-studio-itext"><strong>{w.id === currentId ? (currentName || w.name) : w.name}</strong></span>
              {w.id === currentId && <span className="pd-studio-check">✓</span>}
            </button>
          ))}

          <div className="pd-menu-sep" />
          <button className="pd-studio-act" onClick={rename}>Rename this workspace…</button>
          <button className="pd-studio-act" onClick={create}>＋ New workspace…</button>
        </div>,
        document.body,
      )}
    </div>
  )
}
