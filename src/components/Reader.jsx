import { useMemo, useState } from 'react'
import { GROUPABLE } from '../lib/phases'
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

export default function Reader({ session, onBack }) {
  const [tab, setTab] = useState('map')
  const pub = session.publish || {}
  const snap = pub.snapshot || session

  const board = useMemo(() => ({
    title: snap.title,
    laneLabels: snap.laneLabels,
    laneRows: snap.laneRows,
    nodes: snap.nodes,
    edges: snap.edges,
  }), [snap])

  const steps = (snap.nodes || [])
    .filter(GROUPABLE)
    .slice()
    .sort((a, b) => (a.data?.numbering || '').localeCompare(b.data?.numbering || '', undefined, { numeric: true }))

  const laneOf = (n) => {
    const h = n.style?.height ?? 72
    const i = Math.max(0, Math.round((n.position.y + h / 2 - 40 - 66) / 132))
    return snap.laneLabels?.[i] || ''
  }


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
            {pub.publishedAt ? <span>Published {new Date(pub.publishedAt).toLocaleDateString()}</span> : null}
          </div>
        </header>

        <div className="pd-reader-tabs">
          <button className={tab === 'map' ? 'is-on' : ''} onClick={() => setTab('map')}>Map</button>
          <button className={tab === 'steps' ? 'is-on' : ''} onClick={() => setTab('steps')}>Steps</button>

        </div>

        {tab === 'map' && (
          <div className="pd-reader-map">
            {snap.nodes?.length
              ? <PresenterView board={board} />
              : <div className="pd-reader-none">This process has no steps yet.</div>}
          </div>
        )}

        {tab === 'steps' && (
          <table className="pd-reader-table">
            <thead>
              <tr><th>#</th><th>Step</th><th>Owner</th><th>Input</th><th>Output</th></tr>
            </thead>
            <tbody>
              {steps.map((n) => (
                <tr key={n.id}>
                  <td className="pd-reader-code">{n.data?.numbering || ''}</td>
                  <td>
                    <strong>{n.data?.label}</strong>
                    {n.data?.description && <div className="pd-reader-desc">{n.data.description}</div>}
                  </td>
                  <td>{laneOf(n)}</td>
                  <td>{n.data?.input || '—'}</td>
                  <td>{n.data?.output || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      </div>
    </div>
  )
}
