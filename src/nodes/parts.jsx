import { useState, useRef, useEffect, useCallback, useContext } from 'react'
import { Handle, Position } from '@xyflow/react'
import { BoardContext } from '../context'

const SIDES = [
  { pos: Position.Top, id: 't' },
  { pos: Position.Right, id: 'r' },
  { pos: Position.Bottom, id: 'b' },
  { pos: Position.Left, id: 'l' },
]

// Each side gets an overlapping target + source handle so a connection can
// start from or land on any edge of the node.
export function Handles() {
  return SIDES.map(({ pos, id }) => (
    <div key={id}>
      <Handle type="target" position={pos} id={`${id}-t`} className="pd-handle pd-handle-target" />
      <Handle type="source" position={pos} id={`${id}-s`} className="pd-handle pd-handle-source" />
    </div>
  ))
}

// Editable text that commits back into board state via BoardContext.
export function Label({ id, value, className, placeholder = 'Double-click to type…' }) {
  const { setNodeLabel } = useContext(BoardContext)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing) {
      setDraft(value ?? '')
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [editing, value])

  const commit = useCallback(() => {
    setEditing(false)
    setNodeLabel(id, draft)
  }, [draft, id, setNodeLabel])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit() }
    if (e.key === 'Escape') setEditing(false)
  }

  if (editing) {
    return (
      <textarea
        ref={inputRef}
        className={`pd-label-input ${className || ''}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        rows={1}
      />
    )
  }
  return (
    <div className={`pd-label ${className || ''}`} onDoubleClick={() => setEditing(true)}>
      {value || <span className="pd-placeholder">{placeholder}</span>}
    </div>
  )
}
