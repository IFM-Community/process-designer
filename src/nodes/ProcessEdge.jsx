import { useState, useContext } from 'react'
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react'
import { BoardContext } from '../context'
import './nodes.css'

// Orthogonal (sharp) edge with a double-click-to-edit label — used for Yes/No
// on decisions, or any note on a connection.
export default function ProcessEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, label, data,
}) {
  const { setEdgeLabel } = useContext(BoardContext)
  // borderRadius 0 = sharp corners (house style). `offset` is how far the line
  // runs straight out of a shape before it may turn — keep it generous so corners
  // sit out in the gap rather than hard against the box, matching the People &
  // Culture manual's routing.
  let [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
    borderRadius: 0, offset: 40,
  })
  // Same-lane bypass (set by relinkEdges): a box sits between these two steps, so
  // instead of running the line straight through it, step out to the edge of the
  // lane band, travel past the obstruction, and come back in to the target.
  if (data?.detourY != null) {
    const y = data.detourY
    const dir = targetX >= sourceX ? 1 : -1
    const sx = sourceX + dir * 34
    const tx = targetX - dir * 34
    path = `M ${sourceX},${sourceY} L ${sx},${sourceY} L ${sx},${y} L ${tx},${y} L ${tx},${targetY} L ${targetX},${targetY}`
    labelX = (sx + tx) / 2
    labelY = y
  }
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label ?? '')

  const commit = () => {
    setEditing(false)
    setEdgeLabel(id, draft.trim())
  }
  const startEdit = (e) => {
    e.stopPropagation()
    setDraft(label ?? '')
    setEditing(true)
  }

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {/* A fat invisible copy of the line, purely to catch clicks.
          Labelling used to need two precise interactions in a row: hover the 1.5px
          line to make a 16px "+" fade in, then double-click that "+" without
          losing the hover. Now the WHOLE line is the target, and one click does it. */}
      <path
        d={path}
        className="pd-edge-hit"
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        onClick={startEdit}
      />
      <EdgeLabelRenderer>
        <div
          className="pd-edge-label nodrag nopan"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onClick={startEdit}
          onDoubleClick={startEdit}
        >
          {editing ? (
            <input
              autoFocus
              className="pd-edge-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commit() }
                if (e.key === 'Escape') setEditing(false)
              }}
            />
          ) : label ? (
            <span className="pd-edge-text" title="Click to edit">{label}</span>
          ) : (
            <span className="pd-edge-hint" title="Click anywhere on this line to label it (e.g. Yes / No)">+</span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
