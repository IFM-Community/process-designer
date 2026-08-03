import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { phasesOf, phaseIdOf, GROUPABLE, PHASE_COLORS, colorOf, branchLabels } from '../lib/phases'

// The Phases view — the process as 4-6 stages, and the place you SHAPE them.
//
// Deliberately NOT drawn on the swimlane map. A phase is contiguous in FLOW ORDER,
// not in space: on the map, consecutive steps stack vertically inside one column,
// so the last step of a stack routinely belongs to the next stage. Drawing a phase
// as a rectangle over the map would have to cut a column in half. Here a stage is a
// column of rows, so that constraint disappears — and a stage spanning five owners
// is simply a column that names five owners.
//
// It's a board, not a report: drag a step from one stage to another to regroup it,
// rename a stage by typing in its header. The AI's grouping is a first draft.

// Steps in true flow order, so a stage lists its steps the way the process runs.
function flowRank(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out = new Map(nodes.map((n) => [n.id, []]))
  const indeg = new Map(nodes.map((n) => [n.id, 0]))
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue
    out.get(e.source).push(e.target)
    indeg.set(e.target, indeg.get(e.target) + 1)
  }
  const ready = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id)
  const order = []
  const seen = new Set()
  while (ready.length) {
    const id = ready.shift()
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
    for (const t of out.get(id) || []) {
      indeg.set(t, indeg.get(t) - 1)
      if (indeg.get(t) <= 0 && !seen.has(t)) ready.push(t)
    }
  }
  for (const n of nodes) if (!seen.has(n.id)) order.push(n.id)
  return new Map(order.map((id, i) => [id, i]))
}

const UNGROUPED = '__none__'

// A textarea that is always exactly as tall as its text.
//
// This has to be a LAYOUT EFFECT keyed on the value, not a ref callback: React runs
// a ref callback once on mount, so a name that grows later — you typing, or the AI
// renaming the stage — was never re-measured and the last line stayed clipped.
//
// scrollHeight is the CONTENT height, so under border-box (this app's default) the
// border and padding must be added back or the box comes out a couple of px short.
function AutoGrowTextarea({ value, ...rest }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const cs = getComputedStyle(el)
    const chrome = cs.boxSizing === 'border-box' ? el.offsetHeight - el.clientHeight : 0
    el.style.height = `${el.scrollHeight + chrome}px`
  }, [value])
  return <textarea ref={ref} value={value} {...rest} />
}

// Defined at MODULE scope on purpose. Declaring a component inside another
// component's body makes React see a brand-new component type on every render, so
// every row unmounts and remounts — and the row you are dragging is destroyed the
// instant drag state changes, which cancelled the drag. That was the "I have to
// click several times to drag" bug.
function StepRow({ s, laneOf, branch, dragging, selected, onSelect, onDragStart, onDragEnd }) {
  return (
    <li
      className={`pd-pk-step ${dragging ? 'is-dragging' : ''} ${selected ? 'is-selected' : ''}`}
      draggable
      onClick={(e) => onSelect(s.id, e)}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/pd-step', s.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(s.id)
      }}
      onDragEnd={onDragEnd}
      title="Click to select (⌘/Ctrl-click for several) · drag to another stage"
    >
      <span className="pd-pk-grip">⠿</span>
      <span className="pd-pk-step-main">
        {s.data?.numbering && <span className="pd-pk-code">{s.data.numbering}</span>}
        <span className="pd-pk-label">{s.data?.label || '(untitled)'}</span>
        {/* Entered only on a branch — so you can see the scenario while grouping. */}
        {branch && <span className="pd-pk-branch">⑂ {branch}</span>}
      </span>
      <span className="pd-pk-owner">{laneOf(s)}</span>
    </li>
  )
}

// A visible clock for the 2-4 minute AI actions, so "Grouping…" doesn't read as a
// hang, plus a Stop — mirrors the command dock.
function useElapsed(active) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!active) { setN(0); return }
    const t = setInterval(() => setN((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [active])
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
}

export default function PhasesView({
  session, laneOf, onRename, onGroup, onAssign, onAddPhase, onDeletePhase, onRecolor,
  onRenameAll, onReorderPhase, naming, busy, onStop,
}) {
  const clock = useElapsed(busy || naming)
  const phases = phasesOf(session)
  const [zoom, setZoom] = useState(1) // the board is plain DOM, so zoom is a scale
  const [dragOver, setDragOver] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [dragStage, setDragStage] = useState(null)
  // Multi-select: ⌘/Ctrl-click adds to the selection, and dragging any selected row
  // moves the whole selection at once.
  const [selected, setSelected] = useState(() => new Set())

  const selectStep = useCallback((id, e) => {
    const multi = e.metaKey || e.ctrlKey
    setSelected((prev) => {
      const next = new Set(multi ? prev : [])
      if (multi && prev.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const rank = useMemo(() => flowRank(session.nodes, session.edges), [session.nodes, session.edges])
  // Which steps sit on an alternative path, and under what condition.
  const branches = useMemo(() => branchLabels(session.nodes, session.edges), [session.nodes, session.edges])

  const columns = useMemo(() => {
    const byPhase = new Map(phases.map((p) => [p.id, []]))
    const loose = []
    // Start / End are punctuation, not work — they belong to no stage (§ GROUPABLE).
    for (const n of session.nodes.filter(GROUPABLE)) {
      const pid = phaseIdOf(n)
      if (pid && byPhase.has(pid)) byPhase.get(pid).push(n)
      else loose.push(n)
    }
    // Order a stage's steps by their NUMBER — the chronological order the reader
    // reads off the codes (001, 002, 003 …). Fall back to flow position only for
    // steps with no number, so nothing without a code jumps around.
    const numOf = (n) => { const m = /(\d+)\s*$/.exec(n.data?.numbering || ''); return m ? parseInt(m[1], 10) : null }
    const sortSteps = (a, b) => {
      const na = numOf(a); const nb = numOf(b)
      if (na != null && nb != null && na !== nb) return na - nb
      return (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)
    }
    const list = phases.map((p) => {
      const steps = (byPhase.get(p.id) || []).sort(sortSteps)
      return { ...p, steps }
    })
    // Display order is the STORED order, not flow position — otherwise dragging a
    // stage somewhere would snap straight back. The AI returns them in flow order,
    // so the default is already right; dragging then overrides it.
    return { list, loose: loose.sort(sortSteps) }
  }, [phases, session.nodes, rank, laneOf])

  if (!phases.length) {
    return (
      <div className="pd-phases-empty">
        <h3>No stages yet</h3>
        <p>
          Group the steps into 4–6 stages so the process can be told as
          “① … → ② … → ③ …”. You can then rename any stage and drag steps between them.
        </p>
        <button className="pd-generate-btn" onClick={onGroup} disabled={busy}>
          {busy ? `Grouping… ${clock}` : '⧉ Group into phases'}
        </button>
        {busy && onStop && (
          <button className="pd-cmd-stop" style={{ marginTop: 10 }} onClick={onStop} title="Stop grouping">◼ Stop</button>
        )}
      </div>
    )
  }

  const beginDrag = useCallback((id) => {
    setDragging(id)
    // Dragging a row that isn't part of the selection means you meant just that one.
    setSelected((prev) => (prev.has(id) ? prev : new Set([id])))
  }, [])

  const drop = (phaseId) => (e) => {
    e.preventDefault()
    // A stage being dropped on a stage means "reorder", not "move steps into".
    const stageId = e.dataTransfer.getData('application/pd-stage') || dragStage
    if (stageId && phaseId !== UNGROUPED) {
      setDragStage(null)
      setDragOver(null)
      if (stageId !== phaseId) onReorderPhase(stageId, phaseId)
      return
    }
    const id = e.dataTransfer.getData('application/pd-step') || dragging
    setDragOver(null)
    setDragging(null)
    if (!id) return
    // Move everything selected, so ⌘-click + drag regroups a whole run at once.
    const ids = selected.has(id) ? [...selected] : [id]
    onAssign(ids, phaseId === UNGROUPED ? null : phaseId)
    setSelected(new Set())
  }

  return (
    <div className="pd-phases">
      <div className="pd-phases-bar">
        <span className="pd-phases-title">{session.title}</span>
        <span className="pd-phases-sub">
          {columns.list.length} stages · {session.nodes.filter(GROUPABLE).length} steps ·{' '}
          {selected.size
            ? `${selected.size} selected — drag any of them to move all`
            : 'drag a step to move it · ⌘/Ctrl-click to select several'}
        </span>
        <div className="pd-pk-zoom" title="Zoom the board (⌘/Ctrl + scroll also works)">
          <button onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))}>−</button>
          <button className="pd-pk-zoom-val" onClick={() => setZoom(1)} title="Reset to 100%">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}>+</button>
        </div>
        <button className="pd-ghost-btn" onClick={onAddPhase}>+ Stage</button>
        {/* Names go stale the moment you drag steps around — this re-derives them
            from what each stage NOW holds, without touching the grouping. */}
        <button
          className="pd-ai-btn"
          onClick={onRenameAll}
          disabled={naming || busy}
          title="Re-name every stage from the steps it now contains. Your grouping is not changed."
        >
          {naming ? 'Naming…' : '✎ Rename stages'}
        </button>
        <button
          className="pd-ai-btn"
          onClick={onGroup}
          disabled={busy || naming}
          title="Ask the AI to group the steps again from scratch — this REPLACES your grouping."
        >
          {busy ? `Grouping… ${clock}` : '⟳ Re-group'}
        </button>
        {(busy || naming) && onStop && (
          <button className="pd-cmd-stop" onClick={onStop} title="Stop this AI action">◼ Stop</button>
        )}
      </div>

      <div
        className="pd-pk-scroll"
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return // plain scroll still scrolls
          e.preventDefault()
          setZoom((z) => Math.min(2, Math.max(0.4, +(z - Math.sign(e.deltaY) * 0.08).toFixed(2))))
        }}
      >
      <div className="pd-pk-board" style={{ transform: `scale(${zoom})`, width: `${100 / zoom}%` }}>
        {columns.list.map((c, i) => (
          <div className="pd-pk-colwrap" key={c.id}>
            <section
              className={`pd-pk-col ${dragOver === c.id ? (dragStage ? 'is-over-stage' : 'is-over') : ''} ${dragStage === c.id ? 'is-moving' : ''}`}
              style={{ '--stage': colorOf(c).hex }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(c.id) }}
              onDragLeave={() => setDragOver((v) => (v === c.id ? null : v))}
              onDrop={drop(c.id)}
            >
              <header className="pd-pk-head">
                {/* A dedicated handle: the step rows inside are draggable too, so
                    the column itself must not be, or the two would fight. */}
                <span
                  className="pd-pk-move"
                  draggable
                  title="Drag to reorder this stage"
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/pd-stage', c.id)
                    e.dataTransfer.effectAllowed = 'move'
                    setDragStage(c.id)
                  }}
                  onDragEnd={() => { setDragStage(null); setDragOver(null) }}
                >
                  ⠿
                </span>
                <span className="pd-pk-num">{i + 1}</span>
                {/* Always editable — renaming a stage shouldn't need discovering.
                    A textarea, not an input: stage names run to several words and an
                    input silently truncates them ("Hiring request and endorser…"). */}
                <AutoGrowTextarea
                  className="pd-pk-name"
                  rows={1}
                  value={c.label}
                  placeholder="Stage name"
                  onChange={(e) => onRename(c.id, e.target.value)}
                  spellCheck={false}
                />
                <select
                  className="pd-pk-color"
                  value={c.color || 'main'}
                  title="Colour this stage — use a different one for an alternative scenario"
                  onChange={(e) => onRecolor(c.id, e.target.value)}
                >
                  {PHASE_COLORS.map((col) => (
                    <option key={col.id} value={col.id}>{col.label}</option>
                  ))}
                </select>
                <button
                  className="pd-pk-del"
                  title="Delete this stage (its steps become ungrouped)"
                  onClick={() => onDeletePhase(c.id)}
                >
                  ✕
                </button>
              </header>
              <div className="pd-pk-meta">
                {c.steps.length} step{c.steps.length === 1 ? '' : 's'}
              </div>
              <ul className="pd-pk-steps">
                {c.steps.map((s) => (
                  <StepRow
                    key={s.id} s={s} laneOf={laneOf} branch={branches.get(s.id)}
                    dragging={dragging === s.id || (dragging && selected.has(s.id))}
                    selected={selected.has(s.id)}
                    onSelect={selectStep}
                    onDragStart={beginDrag}
                    onDragEnd={() => { setDragging(null); setDragOver(null) }}
                  />
                ))}
                {!c.steps.length && <li className="pd-pk-drophint">Drag steps here</li>}
              </ul>
            </section>
            {i < columns.list.length - 1 && <span className="pd-pk-arrow">→</span>}
          </div>
        ))}
      </div>
      </div>

      {/* Steps in no stage. A real holding area you can drag out of — and back
          into, when a step doesn't belong to any stage after all. */}
      <section
        className={`pd-pk-loose ${dragOver === UNGROUPED ? 'is-over' : ''} ${columns.loose.length ? '' : 'is-empty'}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(UNGROUPED) }}
        onDragLeave={() => setDragOver((v) => (v === UNGROUPED ? null : v))}
        onDrop={drop(UNGROUPED)}
      >
        <header>
          Not in any stage
          <span className="pd-pk-loose-count">{columns.loose.length}</span>
        </header>
        <ul className="pd-pk-steps is-row">
          {columns.loose.map((s) => (
            <StepRow
              key={s.id} s={s} laneOf={laneOf} branch={branches.get(s.id)}
              dragging={dragging === s.id || (dragging && selected.has(s.id))}
              selected={selected.has(s.id)}
              onSelect={selectStep}
              onDragStart={beginDrag}
              onDragEnd={() => { setDragging(null); setDragOver(null) }}
            />
          ))}
          {!columns.loose.length && <li className="pd-pk-drophint">Drag a step here to take it out of its stage.</li>}
        </ul>
      </section>
    </div>
  )
}
