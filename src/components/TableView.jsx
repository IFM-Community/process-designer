import { useRef, useLayoutEffect } from 'react'
import { SHAPE_MAP } from '../shapes'
import './TableView.css'

// A textarea that grows to fit its content so no text is ever clipped.
function AutoCell({ value, onChange, placeholder, className = '' }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      className={`pd-cell pd-cell-auto ${className}`}
      value={value}
      placeholder={placeholder}
      rows={1}
      onChange={onChange}
    />
  )
}

// The process-procedure table. Each row is a board node; edits sync live to the
// map (shared state). Responsibility is the node's lane.
export default function TableView({ rows, lanes, onUpdateNode, onSetResponsibility, onAddRow, onDeleteRow }) {
  return (
    <div className="pd-table-wrap">
      <table className="pd-table">
        <thead>
          <tr>
            <th className="pd-col-num">#</th>
            <th className="pd-col-act">Activity</th>
            <th className="pd-col-desc">Description</th>
            <th className="pd-col-resp">Responsibility</th>
            <th className="pd-col-io">Input</th>
            <th className="pd-col-io">Output</th>
            <th className="pd-col-dur">Duration</th>
            <th className="pd-col-del"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="pd-table-empty">
                No steps yet. Add a row, or generate a process with AI.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="pd-col-num">
                <AutoCell
                  value={r.data.numbering || ''}
                  placeholder="HR-001-001-001"
                  onChange={(e) => onUpdateNode(r.id, { numbering: e.target.value })}
                />
              </td>
              <td className="pd-col-act">
                <AutoCell
                  className="pd-cell-strong"
                  value={r.data.label || ''}
                  placeholder={SHAPE_MAP[r.type]?.name || 'Activity'}
                  onChange={(e) => onUpdateNode(r.id, { label: e.target.value })}
                />
              </td>
              <td className="pd-col-desc">
                <AutoCell
                  value={r.data.description || ''}
                  placeholder="What happens in this step…"
                  onChange={(e) => onUpdateNode(r.id, { description: e.target.value })}
                />
              </td>
              <td className="pd-col-resp">
                <select
                  className="pd-cell pd-cell-select"
                  value={r.lane}
                  onChange={(e) => onSetResponsibility(r.id, Number(e.target.value))}
                >
                  {lanes.map((label, i) => (
                    <option key={i} value={i}>{label || `Role ${i + 1}`}</option>
                  ))}
                </select>
              </td>
              <td className="pd-col-io">
                <AutoCell
                  value={r.data.input || ''}
                  placeholder="-"
                  onChange={(e) => onUpdateNode(r.id, { input: e.target.value })}
                />
              </td>
              <td className="pd-col-io">
                <AutoCell
                  value={r.data.output || ''}
                  placeholder="-"
                  onChange={(e) => onUpdateNode(r.id, { output: e.target.value })}
                />
              </td>
              <td className="pd-col-dur">
                <AutoCell
                  value={r.data.duration || ''}
                  placeholder="-"
                  onChange={(e) => onUpdateNode(r.id, { duration: e.target.value })}
                />
              </td>
              <td className="pd-col-del">
                <button className="pd-row-del" title="Delete row" onClick={() => onDeleteRow(r.id)}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="pd-table-add" onClick={onAddRow}>+ Add row</button>
    </div>
  )
}
