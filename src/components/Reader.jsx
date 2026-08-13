import { useMemo, useState } from 'react'
import { GROUPABLE } from '../lib/phases'
import { flowOrder } from '../lib/layout'
import { prefixOf } from '../lib/processCode'
import { statusOf, PUBLISHED } from '../lib/publish'
import PresenterView from './PresenterView'

// Reading a published process. The Library is for looking things up, not editing.
//
// The map here is a rendered SVG, not a React Flow canvas. That is deliberate:
// read-only by CONSTRUCTION rather than by a disabled flag someone can forget to
// set. There is no palette, no drag handler and no AI action anywhere in this
// component — the editing machinery simply isn't present.
//
// It reads the published SNAPSHOT, never the draft, so what a reader sees is what
// the author signed off, not whatever is being typed in the studio right now.

export default function Reader({ session, processes = [], onOpen, onBack }) {
  const [tab, setTab] = useState('map')
  // "Who are you?" — pick your role and your own steps stay lit while the rest dim,
  // so a reader can find just the parts that are theirs. '' = show everyone.
  const [asRole, setAsRole] = useState('')
  // A referenced process linked to slides opens them here, stacked. { label, images }.
  const [viewer, setViewer] = useState(null)
  const pub = session.publish || {}
  const snap = pub.snapshot || session

  const board = useMemo(() => ({
    title: snap.title,
    laneLabels: snap.laneLabels,
    laneRows: snap.laneRows,
    nodes: snap.nodes,
    edges: snap.edges,
  }), [snap])

  // Flow order, so every step — including a referenced-process link, which carries
  // no number of its own — sits where it actually runs instead of jumping to the
  // top of the list.
  const rank = useMemo(() => {
    const { order } = flowOrder(snap.nodes || [], snap.edges || [])
    return new Map(order.map((id, i) => [id, i]))
  }, [snap])

  const steps = useMemo(() => (snap.nodes || [])
    .filter(GROUPABLE)
    .slice()
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)), [snap, rank])

  const laneOf = (n) => {
    const h = n.style?.height ?? 72
    const i = Math.max(0, Math.round((n.position.y + h / 2 - 40 - 66) / 132))
    return snap.laneLabels?.[i] || ''
  }

  // A referenced-process shape points at another process; resolve it so we can show
  // that process's CODE (not the empty number it carries) and, when that process is
  // itself published, open it.
  const refTargetOf = (n) => (n.type === 'referencedProcess' && n.data?.refId)
    ? processes.find((p) => p.id === n.data.refId)
    : null
  const codeOf = (n) => {
    const t = refTargetOf(n)
    return t ? prefixOf(t) : (n.data?.numbering || '')
  }

  const owners = (snap.laneLabels || []).filter(Boolean)
  const mine = (n) => !asRole || laneOf(n) === asRole

  // Clicking a referenced-process box on the map opens its images, or the linked
  // process when that process is itself published.
  const openRef = (n) => {
    if (n.data?.images?.length) { setViewer({ label: n.data?.label, images: n.data.images }); return }
    const target = refTargetOf(n)
    if (target && statusOf(target) === PUBLISHED) onOpen(target.id)
  }

  const publishedStr = pub.publishedAt
    ? new Date(pub.publishedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null

  return (
    <div className="pd-reader">
      <div className="pd-reader-inner">
        <button className="pd-reader-back" onClick={onBack}>← All processes</button>

        <header className="pd-reader-head">
          {pub.department && <span className="pd-reader-dept">{pub.department}</span>}
          <h1>{snap.title}</h1>
          {pub.summary && <p className="pd-reader-sum">{pub.summary}</p>}
          <div className="pd-reader-meta">
            <span>{steps.length} steps</span>
            <span>{(snap.laneLabels || []).length} owners</span>
            {pub.approver ? <span>Approved by {pub.approver}</span> : null}
            {publishedStr ? <span>Published {publishedStr}</span> : null}
          </div>
        </header>

        {/* Who are you? — light up just your steps. */}
        {owners.length > 0 && (
          <div className="pd-reader-as">
            <span className="pd-reader-as-label">I am</span>
            <select className="pd-reader-as-select" value={asRole} onChange={(e) => setAsRole(e.target.value)}>
              <option value="">everyone (show all)</option>
              {owners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {asRole && <span className="pd-reader-as-hint">— your steps are highlighted, the rest are dimmed</span>}
          </div>
        )}

        <div className="pd-reader-tabs">
          <button className={tab === 'map' ? 'is-on' : ''} onClick={() => setTab('map')}>Map</button>
          <button className={tab === 'steps' ? 'is-on' : ''} onClick={() => setTab('steps')}>Steps</button>
        </div>

        {tab === 'map' && (
          <div className="pd-reader-map">
            {snap.nodes?.length
              ? <PresenterView board={board} highlightOwner={asRole} onOpenRef={openRef} />
              : <div className="pd-reader-none">This process has no steps yet.</div>}
          </div>
        )}

        {tab === 'steps' && (
          <table className="pd-reader-table">
            <thead>
              <tr><th>#</th><th>Step</th><th>Owner</th><th>Input</th><th>Output</th></tr>
            </thead>
            <tbody>
              {steps.map((n) => {
                const target = refTargetOf(n)
                const openable = target && statusOf(target) === PUBLISHED
                const imgs = n.data?.images?.length || 0
                // A referenced process links EITHER to slides (images) OR to another
                // published process. Both are clickable in the reader; images win if
                // present (attaching them clears the process link anyway).
                const onClick = imgs
                  ? () => setViewer({ label: n.data?.label, images: n.data.images })
                  : (openable ? () => onOpen(target.id) : undefined)
                return (
                  <tr
                    key={n.id}
                    className={`${mine(n) ? '' : 'is-dim'} ${onClick ? 'is-link' : ''}`}
                    onClick={onClick}
                    title={imgs ? `View ${imgs} image${imgs > 1 ? 's' : ''}` : (openable ? `Open “${target.title || 'process'}”` : undefined)}
                  >
                    <td className="pd-reader-code">{codeOf(n)}</td>
                    <td>
                      <strong>{n.data?.label}</strong>
                      {imgs ? <span className="pd-reader-open">▦ {imgs} image{imgs > 1 ? 's' : ''}</span> : null}
                      {!imgs && openable && <span className="pd-reader-open">↗ open process</span>}
                      {n.data?.description && <div className="pd-reader-desc">{n.data.description}</div>}
                    </td>
                    <td>{laneOf(n)}</td>
                    <td>{n.data?.input || '—'}</td>
                    <td>{n.data?.output || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Reference-image viewer: the linked slides, stacked top-to-bottom. */}
      {viewer && (
        <div className="pd-imgview-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setViewer(null) }}>
          <div className="pd-imgview">
            <div className="pd-imgview-bar">
              <span className="pd-imgview-title">{viewer.label || 'Referenced process'}</span>
              <button className="pd-imgview-close" onClick={() => setViewer(null)}>✕ Close</button>
            </div>
            <div className="pd-imgview-body">
              {viewer.images.map((src, i) => (
                <img key={i} className="pd-imgview-img" src={src} alt={`${viewer.label || 'Reference'} — ${i + 1}`} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
