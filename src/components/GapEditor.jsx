import { useEffect, useRef, useState } from 'react'
import { linesToText, textToLines } from '../lib/analysisFormat'

// Editor for the gap-analysis box.
//
// Rendered OUTSIDE the React Flow canvas on purpose. It used to live inside the
// analysis node, where React Flow's own pointer handling swallowed the press —
// the Edit button simply could not be clicked, through three attempts at
// nodrag/nopan and stopPropagation. A control that must be clickable does not
// belong inside the canvas; this panel floats above it instead.
export default function GapEditor({ analysis, onSave, onClose }) {
  const [draft, setDraft] = useState(() => linesToText(analysis || []))
  const ref = useRef(null)

  useEffect(() => { ref.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { onSave(textToLines(draft)); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft, onSave, onClose])

  return (
    <div className="pd-gapeditor">
      <div className="pd-gapeditor-head">
        <span>Gap analysis · areas of improvement</span>
        <div className="pd-gapeditor-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="is-primary" onClick={() => { onSave(textToLines(draft)); onClose() }}>✓ Save</button>
        </div>
      </div>
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        placeholder={'Free text — one line each. Examples:\n1. Approvals\n- Do we need CSI and faculty approval at all?\n2. System of record\n- Is Symplicity the one true system?'}
      />
      <div className="pd-gapeditor-tip">
        “1. Heading” = a heading · “- point” = a bullet · “Summary: detail” bolds before the “:” · ⌘/Ctrl+Enter to save · Esc to cancel
      </div>
    </div>
  )
}
