import { useContext, useState, useEffect, useRef } from 'react'
import { NodeToolbar, Position } from '@xyflow/react'
import { SHAPE_MAP, SHAPES } from '../shapes'
import { BoardContext } from '../context'
import { Label, Handles } from './parts'
import ShapeGlyph from '../components/ShapeGlyph'
import { codeFontSize } from '../lib/processCode'
import './nodes.css'

const AUTO_TYPES = ['automatedActivity', 'automatedActivitySystem']
const SYSTEM_TYPES = ['activitySystem', 'automatedActivitySystem']
// Every step that renumberByFlow gives a number to must SHOW it. Decisions and
// referenced processes used to be numbered silently, so the visible sequence read
// 01, 03, 04… 10, 11, 13 — the gaps were the invisible decisions, which made the
// flow look wrong and made it impossible to check what "IHP-12" actually was.
const NUMBERED = [
  'activity', 'automatedActivity', 'activitySystem', 'automatedActivitySystem',
  'decision',
]

// A referenced process is not a step of THIS process — it is a pointer at another
// one. Showing this process's next step number on it was actively misleading: the
// code on that shape has to be the code of the process it points AT, so you can
// read the reference and go look it up. Double-click follows the link.
function ProcessRef({ id, data }) {
  const { processRefs, openProcessRef } = useContext(BoardContext)
  const target = data.refId ? processRefs?.get(data.refId) : null
  const imgs = data.images?.length || 0
  const linked = imgs || target
  const label = imgs
    ? `▦ ${imgs} image${imgs > 1 ? 's' : ''}`
    : (target ? (target.code || target.title) : 'link a process…')
  return (
    <div
      className={`pd-ref-code ${linked ? '' : 'is-unset'}`}
      title={imgs
        ? `${imgs} reference image${imgs > 1 ? 's' : ''} — double-click to view`
        : (target ? `${target.title} — double-click to open it` : 'No process linked yet — double-click to choose one')}
      onDoubleClick={(e) => { e.stopPropagation(); openProcessRef?.(id) }}
    >
      {label}
    </div>
  )
}

// Editable coloured band naming the system a step runs in (Symplicity, e-Services…).
function SystemBand({ id, value }) {
  const { setNodeSystem } = useContext(BoardContext)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const ref = useRef(null)
  useEffect(() => { if (editing) { setDraft(value ?? ''); requestAnimationFrame(() => ref.current?.select()) } }, [editing, value])
  const commit = () => { setEditing(false); setNodeSystem(id, draft.trim()) }
  if (editing) {
    return (
      <input
        ref={ref}
        className="pd-system-input nodrag nopan"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } if (e.key === 'Escape') setEditing(false) }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    )
  }
  return (
    <div className="pd-system-band" onDoubleClick={() => setEditing(true)} title="Double-click to name the system">
      {value || <span className="pd-system-ph">system?</span>}
    </div>
  )
}

export default function ProcessNode({ id, type, data, selected }) {
  const shape = SHAPE_MAP[type] || SHAPE_MAP.activity
  const { setInfo, changeNodeType, pickProcessRef, setCalloutTail } = useContext(BoardContext)
  const isAuto = AUTO_TYPES.includes(type)
  const hasSystem = SYSTEM_TYPES.includes(type)

  return (
    <div
      className={`pd-node pd-node--${type} ${selected ? 'is-selected' : ''}${type === 'callout' ? ` tail-${data.tail || 'br'}` : ''}`}
      onMouseEnter={() => setInfo(shape)}
      onMouseLeave={() => setInfo(null)}
    >
      <NodeToolbar isVisible={selected} position={Position.Top} className="pd-shape-menu">
        {/* Once a reference is linked, double-clicking follows it — so changing or
            removing the link needs its own way in, and per-node actions already
            live on this toolbar. */}
        {/* Which way the callout points. It annotates whatever it sits beside, and
            that can be above, below, left or right — so the tail turns. */}
        {type === 'callout' && (
          <>
            {[['bl', '◣'], ['br', '◢'], ['tl', '◤'], ['tr', '◥']].map(([dir, glyph]) => (
              <button
                key={dir}
                className={`pd-shape-opt ${(data.tail || 'br') === dir ? 'is-on' : ''}`}
                title={`Point the tail ${dir === 'bl' ? 'bottom-left' : dir === 'br' ? 'bottom-right' : dir === 'tl' ? 'top-left' : 'top-right'}`}
                onClick={() => setCalloutTail?.(id, dir)}
              >
                {glyph}
              </button>
            ))}
            <span className="pd-shape-opt-sep" />
          </>
        )}
        {type === 'referencedProcess' && (
          <>
            <button
              className="pd-shape-opt is-wide"
              title="Choose which process this refers to"
              onClick={() => pickProcessRef?.(id)}
            >
              ⛓ Link…
            </button>
            <span className="pd-shape-opt-sep" />
          </>
        )}
        {SHAPES.filter((s) => s.type !== type).map((s) => (
          <button
            key={s.type}
            className="pd-shape-opt"
            title={`Change to ${s.name}`}
            onClick={() => changeNodeType(id, s.type)}
          >
            <ShapeGlyph type={s.type} className="pd-shape-opt-glyph" />
          </button>
        ))}
      </NodeToolbar>
      {type === 'decision' && (
        <svg className="pd-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon points="50,4 96,50 50,96 4,50" />
        </svg>
      )}
      {type === 'database' && (
        <svg className="pd-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M6,18 C6,9 28,4 50,4 C72,4 94,9 94,18 L94,82 C94,91 72,96 50,96 C28,96 6,91 6,82 Z" />
          <path className="pd-shape-stroke" d="M6,18 C6,27 28,32 50,32 C72,32 94,27 94,18" fill="none" />
        </svg>
      )}
      {type === 'dataObject' && (
        <svg className="pd-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M8,6 L92,6 L92,84 C70,74 30,94 8,84 Z" />
        </svg>
      )}

      <div className="pd-node-body">
        {type === 'referencedProcess' && <ProcessRef id={id} data={data} />}
        {NUMBERED.includes(type) && data.numbering && (
          // Shrink long codes so they stay INSIDE the shape (a diamond is much
          // narrower than its box at the line the code sits on).
          <div
            className="pd-numbering"
            style={{
              fontSize: `${codeFontSize(data.numbering, SHAPE_MAP[type]?.size.width || 160, {
                narrow: type === 'decision',
              })}px`,
            }}
          >
            {data.numbering}
          </div>
        )}
        {isAuto && <div className="pd-auto-flag">A</div>}
        <Label id={id} value={data.label} />
        {hasSystem && <SystemBand id={id} value={data.system} />}
      </div>

      <Handles />
    </div>
  )
}
