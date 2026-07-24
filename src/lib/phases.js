// Process brackets ("phases") — the high-level story over a detailed map.
//
// A phase groups steps by WHERE THEY SIT IN THE FLOW, not by who owns them:
// "1 · Identify the request", "2 · Fill information in the system", "3 · Tripartite
// contract"… Lanes are vertical (owners); a phase is horizontal (a span of
// columns), and it deliberately CUTS ACROSS every owner it touches.
//
// That cross-cutting nature is the whole design problem: a collapsed phase has no
// single owner, so it cannot be drawn inside a lane. It is drawn as a full-height
// block spanning all lanes for its columns instead — which is the truthful
// picture, since the phase really does involve all those parties.
//
// The model is deliberately thin: a phase is just an id + label + order, and each
// step records which phase it belongs to. The band's position is DERIVED from
// where its member steps already are, so there is nothing to keep in sync — move a
// step and the bracket follows it.

import { HEADER_W, COL_W, colCenterX } from '../board'

export const PHASE_H = 34 // height of the bracket strip drawn above the board

export const phasesOf = (session) => (Array.isArray(session?.phases) ? session.phases : [])
export const collapsedOf = (session) =>
  new Set(Array.isArray(session?.collapsedPhases) ? session.collapsedPhases : [])

export const phaseIdOf = (node) => node?.data?.phase || null

export const newPhaseId = () => `ph-${Math.random().toString(36).slice(2, 8)}`

// Start / End are punctuation, not work: they carry no owner decision and belong to
// no stage. Excluding them keeps a stage's step count honest ("3 steps" means three
// things someone actually does).
// Callouts are commentary pinned to the map, not steps — they never belong to a stage.
export const GROUPABLE = (n) => n?.type !== 'startEnd' && n?.type !== 'callout'

// Stage colours. A process with alternative endings (ends on time / is extended /
// converts to full-time) can't be told as one straight line — those stages are
// ALTERNATIVES, not successors. Colour is how that reads at a glance: the main path
// in one colour, each scenario in its own.
export const PHASE_COLORS = [
  { id: 'main',   label: 'Main path',   hex: '#154677' },
  { id: 'altA',   label: 'Scenario A',  hex: '#2f7d55' },
  { id: 'altB',   label: 'Scenario B',  hex: '#8a5cc0' },
  { id: 'altC',   label: 'Scenario C',  hex: '#c07b2f' },
  { id: 'except', label: 'Exception',   hex: '#b52529' },
]
export const colorOf = (phase) =>
  PHASE_COLORS.find((c) => c.id === (phase?.color || 'main')) || PHASE_COLORS[0]

// The branch label that leads INTO a step ("Yes", "No", "> AED 50,000"), so while
// grouping you can see which steps sit on an alternative path rather than having to
// remember the flow.
export function branchLabels(nodes, edges) {
  const out = new Map()
  for (const e of edges) {
    const l = String(e.label || '').trim()
    if (l) out.set(e.target, l)
  }
  return out
}

// Which column a node sits in.
export function colOfNode(node, sizeOf) {
  const size = sizeOf(node)
  if (!size) return 0
  return Math.max(0, Math.round((node.position.x + size.width / 2 - HEADER_W - COL_W / 2) / COL_W))
}

// The column span each phase occupies, derived from its members. Phases with no
// members get no span (and so aren't drawn) rather than a bogus zero-width one.
//
// A phase's members should be contiguous in the flow; if they aren't, we take
// min..max, which is the only span that actually contains them all. `gappy` flags
// that so the UI can say so instead of quietly drawing something misleading.
export function phaseSpans(session, nodes, sizeOf) {
  const phases = phasesOf(session)
  const cols = new Map() // phaseId -> Set(col)
  for (const n of nodes) {
    const pid = phaseIdOf(n)
    if (!pid) continue
    if (!cols.has(pid)) cols.set(pid, new Set())
    cols.get(pid).add(colOfNode(n, sizeOf))
  }
  const out = []
  for (const ph of phases) {
    const set = cols.get(ph.id)
    if (!set || !set.size) continue
    const list = [...set].sort((a, b) => a - b)
    const from = list[0]
    const to = list[list.length - 1]
    out.push({ ...ph, from, to, gappy: to - from + 1 !== list.length, count: countIn(nodes, ph.id) })
  }
  return out.sort((a, b) => a.from - b.from)
}

const countIn = (nodes, pid) => nodes.filter((n) => phaseIdOf(n) === pid).length

// Pixel geometry of a span, so the band and the collapsed block agree exactly.
export const spanX = (from) => colCenterX(from) - COL_W / 2
export const spanW = (from, to) => (to - from + 1) * COL_W

// Which owners a phase involves — what a collapsed block has to name, since it
// belongs to all of them and to none of them in particular.
export function ownersOf(nodes, pid, laneOfNode, laneLabels) {
  const seen = new Set()
  for (const n of nodes) {
    if (phaseIdOf(n) !== pid) continue
    const l = laneOfNode(n)
    if (laneLabels[l]) seen.add(laneLabels[l])
  }
  return [...seen]
}

// Rewire edges around collapsed phases: an edge into a hidden step becomes an edge
// into that phase's block, an edge out of one comes from the block, and edges
// wholly inside a collapsed phase disappear. Without this the arrows would point
// at boxes that are no longer on screen.
export function foldEdges(edges, nodes, collapsed) {
  if (!collapsed.size) return edges
  const phaseOfNode = new Map(nodes.map((n) => [n.id, phaseIdOf(n)]))
  const hidden = (id) => {
    const p = phaseOfNode.get(id)
    return p && collapsed.has(p) ? p : null
  }
  const out = []
  const seen = new Set()
  for (const e of edges) {
    const hs = hidden(e.source)
    const ht = hidden(e.target)
    if (hs && ht && hs === ht) continue // internal to a collapsed phase
    const source = hs ? `phase:${hs}` : e.source
    const target = ht ? `phase:${ht}` : e.target
    if (source === target) continue
    const key = `${source}->${target}`
    if (seen.has(key)) continue // several steps folding into one block = one arrow
    seen.add(key)
    out.push({ ...e, id: `${e.id || key}${hs || ht ? '-folded' : ''}`, source, target, data: { ...(e.data || {}) } })
  }
  return out
}

// Give every phase its OWN disjoint block of columns.
//
// This is the step that makes brackets work at all. The layout packs steps
// vertically to save columns, so a single column happily holds steps from several
// owners — and those steps often belong to DIFFERENT phases. Left alone, phase 1
// ends up spanning columns 0-1, phase 2 column 1, phase 3 columns 1-2: overlapping
// brackets, and collapsed blocks drawn on top of each other.
//
// So once a map has phases, compactness gives way to structure: phases are laid
// out one after another, each starting where the previous one ended. Inside a
// phase the usual vertical packing still applies, so the map only grows by as much
// as the brackets genuinely require.
//
// `colOf` is a Map(id -> column) from the normal packer; returns a new Map.
export function separatePhaseColumns(nodes, colOf, phases, order) {
  const members = new Map() // phaseId -> node ids
  for (const n of nodes) {
    const pid = phaseIdOf(n)
    if (!pid) continue
    if (!members.has(pid)) members.set(pid, [])
    members.get(pid).push(n.id)
  }
  if (!members.size) return colOf

  // Phase order: the declared order when we have one, else by where they landed.
  const minCol = (pid) => Math.min(...members.get(pid).map((id) => colOf.get(id) ?? 0))
  const ordered = (order?.length ? order.map((p) => p.id) : [...members.keys()])
    .filter((pid) => members.has(pid))
    .sort((a, b) => (order?.length ? 0 : minCol(a) - minCol(b)))

  const out = new Map(colOf)
  let cursor = 0
  for (const pid of ordered) {
    const ids = members.get(pid)
    const lo = Math.min(...ids.map((id) => colOf.get(id) ?? 0))
    const shift = cursor - lo
    let hi = cursor
    for (const id of ids) {
      const c = (colOf.get(id) ?? 0) + shift
      out.set(id, c)
      if (c > hi) hi = c
    }
    cursor = hi + 1 // the next phase starts in a fresh column
  }
  // Anything with no phase trails the phased steps rather than colliding with them.
  for (const n of nodes) {
    if (phaseIdOf(n)) continue
    out.set(n.id, cursor + (colOf.get(n.id) ?? 0))
  }
  return out
}

// Assign a whole run of steps to a phase, replacing any previous membership.
export function assignPhase(nodes, ids, phaseId) {
  const set = new Set(ids)
  return nodes.map((n) => (set.has(n.id) ? { ...n, data: { ...n.data, phase: phaseId } } : n))
}

// Finish the grouping after an edit.
//
// When a process already has stages and an AI edit ADDS steps, those new steps
// arrive with no stage — the grouping is left "unfinished", with a gap in the
// middle of the story. Rather than make the user re-run "Group into phases" (which
// would also disturb the stages they've curated), slot each unassigned step into
// the stage of its nearest neighbour in flow order: inherit the previous step's
// stage, or the next one's if it comes before any assigned step.
//
// No-op for a process that has no stages at all — we complete a grouping, we don't
// invent one. `order` is the flow-order id list (from flowOrder().order).
export function fillPhaseGaps(nodes, order) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const seq = order.map((id) => byId.get(id)).filter((n) => n && GROUPABLE(n))
  if (!seq.some((n) => phaseIdOf(n))) return nodes // nothing grouped → leave it alone
  if (seq.every((n) => phaseIdOf(n))) return nodes // already complete

  const fill = new Map()
  // Forward pass: inherit the previous assigned step's stage.
  let prev = null
  for (const n of seq) {
    const pid = phaseIdOf(n)
    if (pid) prev = pid
    else if (prev) fill.set(n.id, prev)
  }
  // Backward pass: anything before the first assigned step takes the next one's.
  let next = null
  for (let i = seq.length - 1; i >= 0; i--) {
    const n = seq[i]
    const pid = phaseIdOf(n)
    if (pid) next = pid
    else if (!fill.has(n.id) && next) fill.set(n.id, next)
  }
  if (!fill.size) return nodes
  return nodes.map((n) => (fill.has(n.id) ? { ...n, data: { ...n.data, phase: fill.get(n.id) } } : n))
}
