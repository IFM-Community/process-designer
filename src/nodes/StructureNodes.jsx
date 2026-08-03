import { useContext, useRef, useState } from 'react'
import { BoardContext } from '../context'
import { gapsToLines, linesToText, textToLines, classifyLine } from '../lib/analysisFormat'
import './nodes.css'

// Green title bar spanning the whole board (edited via the toolbar title field).
export function TitleNode({ data }) {
  return (
    <div className="pd-title-node">
      <span className="pd-title-node-text">{data.label || 'Untitled process'}</span>
    </div>
  )
}

// Full-width visual band behind a lane's steps. Click-through so the canvas can
// still be panned by dragging over it.
export function LaneBandNode({ data }) {
  return <div className={`pd-lane-band ${data.index % 2 === 1 ? 'is-alt' : ''}`} />
}

// Gap-analysis box under the board. A clean outline display with an "Edit"
// toggle that opens a free-form text area — type anything: "1. Heading" lines
// become headings, "- point" lines become indented bullets, "Summary: detail"
// bolds the part before the colon.
export function AnalysisNode({ data }) {
  const { openGapEditor } = useContext(BoardContext)
  const lines = gapsToLines(data.gaps || [])
  // Buttons inside a React Flow node don't reliably take a click, so the gap
  // controls (Regenerate / Hide / Edit) live in the ✦ Gaps menu in the command
  // dock. This box is display-only; double-click still opens the editor.
  return (
    <div className={`pd-analysis-box nodrag nopan ${data.stale ? 'is-stale' : ''}`}>
      <div className="pd-analysis-head">
        <span className="pd-analysis-title">Gap analysis · areas of improvement</span>
        {data.stale
          ? <span className="pd-analysis-stale">⚠ May be out of date — the map changed since this was written. Use ✦ Gaps → Regenerate.</span>
          : <span className="pd-analysis-hint">double-click to edit · controls in the dock below</span>}
      </div>
      <div className="pd-analysis-list" onDoubleClick={openGapEditor}>
        {lines.map((line, i) => {
          const c = classifyLine(line)
          if (c.kind === 'header') return <div className="pd-analysis-header" key={i}>{c.text}</div>
          if (c.kind === 'sub') return (
            <div className="pd-analysis-item is-sub" key={i}>
              <span className="pd-analysis-dash">–</span>
              <span className="pd-analysis-text">{c.text}</span>
            </div>
          )
          return (
            <div className="pd-analysis-item" key={i}>
              <span className="pd-analysis-dash">–</span>
              {/* Verdict and evidence are separate ELEMENTS with a CSS gap. They
                  used to be a bold span followed by a raw text node beginning with
                  a space, which leaves the spacing at the mercy of whitespace
                  handling — and any mismatch shows up as the two runs colliding. */}
              <span className="pd-analysis-text">
                {c.summary ? <span className="pd-analysis-sum">{c.summary}:</span> : null}
                {c.rest ? <span className="pd-analysis-rest">{c.rest}</span> : null}
              </span>
            </div>
          )
        })}
        {!lines.length && <div className="pd-analysis-empty">No notes yet — use “✎ Edit gaps” above the board.</div>}
      </div>
    </div>
  )
}

// The lane's left header column — a small, fully interactive node holding the
// always-editable owner name.
export function LaneNode({ id, data }) {
  const { setNodeLabel } = useContext(BoardContext)
  return (
    <div className="pd-lane-header">
      <input
        className="pd-lane-input nodrag nopan"
        value={data.label}
        placeholder="Role / Owner"
        onChange={(e) => setNodeLabel(id, e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        spellCheck={false}
      />
    </div>
  )
}

// ---- Process brackets (phases) ----

// The bracket strip above the board. Click it to fold the whole stage into one
// block; the label is editable in place, because the AI's first guess at a phase
// name is a starting point, not an answer.
export function PhaseBandNode({ data }) {
  const { togglePhase, renamePhase } = useContext(BoardContext)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(data.label || '')
  const commit = () => { setEditing(false); renamePhase(data.id, draft.trim() || data.label) }

  return (
    <div className={`pd-phaseband ${data.collapsed ? 'is-collapsed' : ''}`}>
      <button
        className="pd-phaseband-toggle nodrag nopan"
        title={data.collapsed ? 'Expand this stage' : 'Collapse this stage into one block'}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => togglePhase(data.id)}
      >
        {data.collapsed ? '▸' : '▾'}
      </button>
      {editing ? (
        <input
          autoFocus
          className="pd-phaseband-input nodrag nopan"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        />
      ) : (
        <span
          className="pd-phaseband-label nodrag nopan"
          title="Double-click to rename this stage"
          onDoubleClick={(e) => { e.stopPropagation(); setDraft(data.label || ''); setEditing(true) }}
        >
          {data.label}
        </span>
      )}
      <span className="pd-phaseband-count">{data.count}</span>
      {/* A bracket whose steps aren't contiguous is drawn min..max, which silently
          swallows steps that don't belong to it — say so rather than mislead. */}
      {data.gappy && <span className="pd-phaseband-warn" title="This stage's steps are not contiguous in the flow — the bracket spans other steps too.">⚠</span>}
    </div>
  )
}

// A collapsed stage. It spans EVERY lane, because a phase belongs to all the
// owners it touches and to no single one of them — the reason it cannot simply be
// drawn inside a lane like an ordinary step.
export function PhaseBlockNode({ data }) {
  const { togglePhase } = useContext(BoardContext)
  return (
    <div
      className="pd-phaseblock nodrag nopan"
      onDoubleClick={() => togglePhase(data.id)}
      title="Double-click to expand this stage"
    >
      <div className="pd-phaseblock-label">{data.label}</div>
      <div className="pd-phaseblock-meta">{data.count} steps</div>
      {data.owners?.length ? (
        <div className="pd-phaseblock-owners">{data.owners.join(' · ')}</div>
      ) : null}
    </div>
  )
}
