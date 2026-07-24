import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { SHAPES } from '../shapes'

function Glyph({ type }) {
  const common = { className: 'pd-glyph' }
  switch (type) {
    case 'startEnd':
      return <svg {...common} viewBox="0 0 40 24"><rect x="1" y="3" width="38" height="18" rx="9" fill="var(--pd-tan)" stroke="var(--pd-tan-dark)" /></svg>
    case 'decision':
      return <svg {...common} viewBox="0 0 40 24"><polygon points="20,2 38,12 20,22 2,12" fill="#fff" stroke="var(--pd-teal)" strokeWidth="1.5" /></svg>
    case 'database':
      return <svg {...common} viewBox="0 0 40 24"><path d="M4,6 C4,3 12,2 20,2 C28,2 36,3 36,6 L36,18 C36,21 28,22 20,22 C12,22 4,21 4,18 Z" fill="var(--pd-tan)" stroke="var(--pd-tan-dark)" /></svg>
    case 'dataObject':
      return <svg {...common} viewBox="0 0 40 24"><path d="M4,2 L36,2 L36,19 C26,15 14,24 4,19 Z" fill="#fff" stroke="var(--pd-teal)" strokeWidth="1.5" /></svg>
    case 'referencedProcess':
      return <svg {...common} viewBox="0 0 40 24"><rect x="2" y="3" width="36" height="18" fill="#fff" stroke="var(--pd-ink)" /><rect x="4" y="5" width="32" height="14" fill="none" stroke="var(--pd-accent-red)" /></svg>
    case 'automatedActivity':
      return <svg {...common} viewBox="0 0 40 24"><rect x="2" y="3" width="36" height="18" fill="#fff" stroke="var(--pd-ink)" /><text x="33" y="10" fontSize="8" fill="var(--pd-accent-red)" fontWeight="700">A</text></svg>
    default:
      return <svg {...common} viewBox="0 0 40 24"><rect x="2" y="3" width="36" height="18" fill="#fff" stroke="var(--pd-ink)" /></svg>
  }
}

// The left column has two jobs, and they are deliberately kept apart:
//
//   REPOSITORY  — which process am I working on (always visible)
//   EDIT TOOLS  — lanes and shapes for the process I'm in (map view only)
//
// They used to be stacked in one undifferentiated column together with the prompt
// panel and the examples list, so "pick a process", "rename an owner", "drag a
// shape" and "make a new process" all looked like the same kind of thing. Creation
// now lives on Home; the shape palette is meaningless outside the map, so it isn't
// rendered there.
export default function Sidebar({
  view, onHome, onLibrary, publishedCount = 0,
  sessions, activeId, onSelect, onNew, onDelete, onRename, onDuplicate, onPin, onSetGroup,
  onArchive, onRestore, archiveDays = 30,
  lanes, onRenameLane, onReorderLane, onAddLane, onRemoveLane, onRemoveLaneAt,
  autoConnect, onAutoConnect,
  info, setInfo,
  user, onLogout, studioBar,
}) {
  const editing = view === 'map' // lanes + shapes only mean something on the board
  const [q, setQ] = useState('')
  const [menuFor, setMenuFor] = useState(null)
  const [menuAnchor, setMenuAnchor] = useState(null)   // viewport rect of the ⋮ that opened the menu
  const [submenuFor, setSubmenuFor] = useState(null)   // row whose "Move to group" is open
  const [newGroupFor, setNewGroupFor] = useState(null) // row awaiting a new group name
  const [newGroupName, setNewGroupName] = useState('')
  const [archiveOpen, setArchiveOpen] = useState(false)

  // Any click outside closes the row menu.
  useEffect(() => {
    if (!menuFor) return
    const close = () => { setMenuFor(null); setSubmenuFor(null) }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuFor])

  // A flat list is fine at five processes and unusable at 250: you would scroll
  // past everything, and the list would push the editing tools off the screen.
  // So the repository is SEARCHABLE and BOUNDED — it scrolls inside its own box
  // instead of growing the sidebar, and filtering is the primary way to navigate
  // once there are more processes than fit on screen.
  const needle = q.trim().toLowerCase()
  // Archived processes leave the working list entirely — they live in their own
  // section at the bottom until their retention runs out.
  const live = sessions.filter((s) => !s.archivedAt)
  const archived = sessions.filter((s) => s.archivedAt)
  const shown = needle
    ? live.filter((s) => (s.title || 'Untitled process').toLowerCase().includes(needle))
    : live
  const daysLeft = (s) =>
    Math.max(0, archiveDays - Math.floor((Date.now() - new Date(s.archivedAt).getTime()) / 864e5))

  // Pinned first, then groups, then everything else. At 250 processes this list is
  // a filing cabinet, and the two or three you are working on this week should not
  // be somewhere around row 180.
  const pinned = shown.filter((s) => s.pinned)
  const rest = shown.filter((s) => !s.pinned)
  const groupNames = [...new Set(rest.map((s) => s.group).filter(Boolean))].sort()
  const allGroups = [...new Set(sessions.map((s) => s.group).filter(Boolean))].sort()

  const counts = new Map()
  for (const s of sessions) if (s.group) counts.set(s.group, (counts.get(s.group) || 0) + 1)

  const closeAll = () => { setMenuFor(null); setSubmenuFor(null) }
  const [dragIdx, setDragIdx] = useState(null)
  const [overIdx, setOverIdx] = useState(null)
  const onDragStart = (e, type) => {
    e.dataTransfer.setData('application/pd-shape', type)
    e.dataTransfer.effectAllowed = 'move'
  }

  const newGroupTarget = sessions.find((x) => x.id === newGroupFor)
  const menuSession = sessions.find((x) => x.id === menuFor)

  // The row menu is rendered to document.body, not inside the row.
  //
  // Inside the row it was clipped: the process list scrolls (overflow-y:auto), so
  // a menu opening near the bottom got cut off and you had to scroll to reach
  // "Move to group". A fixed-position popover anchored to the button escapes the
  // scroll box and every stacking context, and flips upward when it would run off
  // the bottom of the screen.
  const menu = menuSession && menuAnchor && createPortal(
    (() => {
      const MENU_H = 250
      const flipUp = menuAnchor.bottom + MENU_H > window.innerHeight
      const style = {
        position: 'fixed',
        right: Math.max(8, window.innerWidth - menuAnchor.right),
        [flipUp ? 'bottom' : 'top']: flipUp
          ? window.innerHeight - menuAnchor.top + 4
          : menuAnchor.bottom + 4,
      }
      const s = menuSession
      return (
        <div className="pd-menu is-floating" style={style} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { closeAll(); onRename(s.id) }}>Rename<kbd>R</kbd></button>
          <button onClick={() => { closeAll(); onDuplicate(s.id) }}>Duplicate<kbd>D</kbd></button>
          <div className="pd-menu-sep" />
          <button onClick={() => { closeAll(); onPin(s.id, !s.pinned) }}>
            {s.pinned ? 'Unpin' : 'Pin to top'}
          </button>
          {/* A submenu, not a prompt box: the groups that already exist are the
              answer nine times out of ten, and typing a name you already have is
              how you end up with "HR" and "HR " as two groups. */}
          <div
            className="pd-submenu-host"
            onMouseEnter={() => setSubmenuFor(s.id)}
            onMouseLeave={() => setSubmenuFor(null)}
          >
            <button className="pd-menu-more" onClick={() => setSubmenuFor(submenuFor === s.id ? null : s.id)}>
              Move to group<span>›</span>
            </button>
            {submenuFor === s.id && (
              <div className="pd-menu pd-submenu">
                {allGroups.map((g) => (
                  <button
                    key={g}
                    className={s.group === g ? 'is-on' : ''}
                    onClick={() => { closeAll(); onSetGroup(s.id, g) }}
                  >
                    {g}<kbd>{counts.get(g)}</kbd>
                  </button>
                ))}
                {s.group && (
                  <button onClick={() => { closeAll(); onSetGroup(s.id, '') }}>Remove from group</button>
                )}
                {(allGroups.length > 0 || s.group) && <div className="pd-menu-sep" />}
                <button onClick={() => { closeAll(); setNewGroupName(''); setNewGroupFor(s.id) }}>
                  New group…
                </button>
              </div>
            )}
          </div>
          <div className="pd-menu-sep" />
          <button onClick={() => { closeAll(); onArchive(s.id) }} title={`Move to the archive — kept ${archiveDays} days, restorable any time`}>
            Archive
          </button>
          <button
            className="pd-menu-danger"
            disabled={sessions.length <= 1}
            title={sessions.length <= 1 ? "You can't delete your only process" : undefined}
            onClick={() => {
              closeAll()
              if (confirm(`Delete “${s.title || 'Untitled process'}”?\n\nEarlier versions stay in the database, so this is recoverable.`)) onDelete(s.id)
            }}
          >
            Delete
          </button>
        </div>
      )
    })(),
    document.body,
  )

  return (
    <aside className="pd-sidebar">
      {menu}
      {newGroupTarget && (
        <div className="pd-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setNewGroupFor(null) }}>
          <div className="pd-modal is-mini" role="dialog" aria-modal="true">
            <h2>New group</h2>
            <input
              className="pd-card-text"
              autoFocus
              value={newGroupName}
              placeholder="Group name"
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setNewGroupFor(null)
                if (e.key === 'Enter' && newGroupName.trim()) {
                  onSetGroup(newGroupTarget.id, newGroupName.trim())
                  setNewGroupFor(null)
                }
              }}
            />
            <div className="pd-modal-actions">
              <button className="pd-modal-ghost" onClick={() => setNewGroupFor(null)}>Cancel</button>
              <button
                className="pd-modal-go"
                disabled={!newGroupName.trim()}
                onClick={() => { onSetGroup(newGroupTarget.id, newGroupName.trim()); setNewGroupFor(null) }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {/* The studio switcher sits at the very top of the sidebar — "which shared
          workspace am I in" is the first thing this rail answers. A slim Home row
          under it goes to the studio landing (the ◆ brand used to be that home). */}
      {studioBar}
      <button
        className={`pd-brand pd-brand-home-row ${view === 'home' ? 'is-home' : ''}`}
        onClick={onHome}
        title="Studio home — start or open a process"
      >
        <span className="pd-brand-home">⌂</span>
        <span className="pd-brand-name">Home</span>
      </button>

      {/* ---- Repository: which process am I working on ---- */}
      <div className="pd-rail-head">
        <span className="pd-section-title">Processes</span>
        <span className="pd-rail-count">
          {needle ? `${shown.length}/${live.length}` : live.length}
        </span>
      </div>
      {/* Search earns its place once the list is longer than the screen. */}
      {sessions.length > 6 && (
        <input
          className="pd-rail-search"
          value={q}
          placeholder="Search processes…"
          onChange={(e) => setQ(e.target.value)}
          spellCheck={false}
        />
      )}
      <div className="pd-sessions">
        {!shown.length && <div className="pd-rail-empty">No process matches “{q}”.</div>}
        {(() => {
        const row = (s) => (
          <div
            key={s.id}
            className={`pd-session ${s.id === activeId ? 'is-active' : ''}`}
            onClick={() => onSelect(s.id)}
          >
            <span className={`pd-session-dot ${s.publish?.status === 'published' ? 'is-live' : ''}`}
                  title={s.publish?.status === 'published' ? 'Published to the library' : 'Draft'} />
            <span className="pd-session-name">{s.title || 'Untitled process'}</span>
            {/* A bare ✕ offers exactly one action, and the destructive one at that.
                A menu is where rename/duplicate/export belong. */}
            <button
              className="pd-session-menu-btn"
              title="More"
              onClick={(e) => {
                e.stopPropagation()
                if (menuFor === s.id) { closeAll(); return }
                // Anchor to the button in VIEWPORT coordinates so the menu can be
                // rendered outside the scrolling list and still line up with it.
                setMenuAnchor(e.currentTarget.getBoundingClientRect())
                setSubmenuFor(null)
                setMenuFor(s.id)
              }}
            >
              ⋮
            </button>
          </div>
        )

        // Headings only appear once there is something to head. A "Pinned" label
        // above an empty space, or above the whole list, is noise.
        return (
          <>
            {pinned.length > 0 && (
              <>
                <div className="pd-rail-group">Pinned</div>
                {pinned.map(row)}
              </>
            )}
            {groupNames.map((g) => (
              <div key={g}>
                <div className="pd-rail-group">{g}</div>
                {rest.filter((s) => s.group === g).map(row)}
              </div>
            ))}
            {rest.filter((s) => !s.group).length > 0 && (
              <>
                {(pinned.length > 0 || groupNames.length > 0) && (
                  <div className="pd-rail-group">Ungrouped</div>
                )}
                {rest.filter((s) => !s.group).map(row)}
              </>
            )}
          </>
        )
        })()}
      </div>
      {/* OUTSIDE the scroll box: at 250 processes this was stranded below the
          list, so making a new one meant scrolling past everything you own. */}
      <button className="pd-session-new" onClick={onNew}>+ New process</button>

      {/* The archive — a holding pen, not a graveyard. Archived processes are out
          of the way but whole, with the days remaining shown plainly, and Restore
          is one click. Nothing is actually removed until the retention runs out. */}
      {archived.length > 0 && (
        <div className="pd-archive">
          <button className="pd-archive-head" onClick={() => setArchiveOpen((v) => !v)}>
            <span>Archive</span>
            <span className="pd-archive-count">{archived.length}</span>
            <span className="pd-archive-caret">{archiveOpen ? '▾' : '▸'}</span>
          </button>
          {archiveOpen && (
            <div className="pd-archive-list">
              {archived.map((s) => (
                <div className="pd-archived" key={s.id}>
                  <span className="pd-archived-text">
                    <span className="pd-archived-name">{s.title || 'Untitled process'}</span>
                    <span className="pd-archived-days">
                      {daysLeft(s) === 0 ? 'removed today' : `${daysLeft(s)} day${daysLeft(s) === 1 ? '' : 's'} left`}
                    </span>
                  </span>
                  <button className="pd-archived-restore" onClick={() => onRestore(s.id)}>Restore</button>
                </div>
              ))}
              <div className="pd-archive-note">Kept {archiveDays} days, then removed.</div>
            </div>
          )}
        </div>
      )}


      {editing && <>
      <div className="pd-divider" />
      <div className="pd-tools-label">Editing this process</div>

      {/* Lane owners — rename each process-owner row (also editable on the board) */}
      <div className="pd-section-title">Lanes · owners</div>
      <p className="pd-section-sub">Top-to-bottom on the board; numbered bottom-up (#1 is the bottom lane). New lanes are added on top.</p>
      <div className="pd-lanes-edit">
        {lanes.map((label, i) => (
          <div
            className={`pd-lane-row ${overIdx === i && dragIdx !== null ? 'is-drop' : ''}`}
            key={i}
            onDragOver={(e) => { if (dragIdx !== null) { e.preventDefault(); setOverIdx(i) } }}
            onDrop={() => { onReorderLane(dragIdx, i); setDragIdx(null); setOverIdx(null) }}
          >
            <span
              className="pd-lane-drag"
              draggable
              title="Drag to reorder this lane"
              onDragStart={() => setDragIdx(i)}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
            >
              ⠿
            </span>
            {/* numbered bottom-to-top: the bottom "doing" lane is #1 */}
            <span className="pd-lane-index">{lanes.length - i}</span>
            <input
              value={label}
              placeholder={`Role ${lanes.length - i}`}
              onChange={(e) => onRenameLane(i, e.target.value)}
              spellCheck={false}
            />
            {lanes.length > 1 && (
              <button
                className="pd-lane-remove"
                title={`Delete this lane (${label || 'Role ' + (lanes.length - i)}) — its steps move to the next lane`}
                onClick={() => (onRemoveLaneAt ? onRemoveLaneAt(i) : onRemoveLane())}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <button className="pd-session-new" onClick={onAddLane}>+ Add lane (top)</button>
      </div>

      <div className="pd-divider" />

      <div className="pd-section-title">Shapes</div>
      <label className="pd-pref" title="When you drop a shape, connect it to the nearest step on its left">
        <input type="checkbox" checked={autoConnect} onChange={(e) => onAutoConnect(e.target.checked)} />
        Auto-connect dropped shapes
      </label>
      <p className="pd-section-sub">Drag onto a lane. They snap into place and auto-connect. Double-click text to edit.</p>
      <div className="pd-palette">
        {SHAPES.map((s) => (
          <div
            key={s.type}
            className="pd-palette-item"
            draggable
            onDragStart={(e) => onDragStart(e, s.type)}
            onMouseEnter={() => setInfo(s)}
            onMouseLeave={() => setInfo(null)}
          >
            <Glyph type={s.type} />
            <div className="pd-palette-text">
              <span className="pd-palette-name">{s.name}</span>
              <span className="pd-palette-hint">{s.hint}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Explanation panel — updates on hover of a palette item or canvas shape */}
      <div className="pd-info">
        {info ? (
          <>
            <div className="pd-info-title">{info.name}</div>
            <div className="pd-info-desc">{info.desc}</div>
          </>
        ) : (
          <div className="pd-info-empty">Hover a shape to see what it means.</div>
        )}
      </div>
      </>}

      {/* Account, pinned to the bottom-left — who you're signed in as, and the way
          out. Sign-out also lives in the studio switcher, but a visible account
          footer is where anyone looks for it. */}
      {user && (
        <div className="pd-account">
          <span className="pd-account-avatar">{(user.name || user.email || '?')[0]?.toUpperCase()}</span>
          <span className="pd-account-who">
            <strong>{user.name || 'You'}</strong>
            <span>{user.email}</span>
          </span>
          <button className="pd-account-logout" onClick={onLogout} title="Sign out">Sign out</button>
        </div>
      )}
    </aside>
  )
}
