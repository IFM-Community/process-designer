import { SHAPE_MAP } from '../shapes'
import { colCenterX, pickHandles } from '../board'
import { slotCenterY } from './lanes'

// Turn the AI's { title, lanes, nodes, edges } spec into swimlane-board state:
// nodes placed in their owner's lane, columns by flow depth, orthogonal edges.

// Column per node — "fill vertically first". Each step is placed in its
// predecessor's column if that column still has a free slot in the step's lane
// (i.e. there's space above/below to stack into); only when that lane slot is
// already taken do we open a new column. This packs the board compactly (a new
// role in the same stage stacks in the same column) instead of drifting right one
// step at a time. `colOverride` pins a node to an explicit column.
//
// Shared by specToBoard (first render) and tidyColumns (re-packing a board the
// user has dragged around) — one implementation, so the two can never drift.
function packColumns({ order, incoming, laneOf, colOverride = () => undefined }) {
  const colOf = new Map()
  const occupied = new Set() // `${lane}:${col}`
  // Branch siblings that land in the SAME lane STACK in one column instead of
  // spreading across columns: a decision whose "no" ends the process and whose
  // "yes" hands to another process, both in the owner's lane, should read as End on
  // top and the reference directly below it (the lane grows a row) — not as two
  // boxes side by side. `siblingCol` remembers the column the first same-lane child
  // of a predecessor took; `cellNodes` lets us refuse to stack onto a cell that a
  // NON-sibling already holds. The actual row-stacking happens in specToBoard,
  // which grows laneRows to fit whatever shares a (lane, col).
  const siblingCol = new Map() // `${predId}:${lane}` -> col of the first sibling there
  const cellNodes = new Map()  // `${lane}:${col}` -> [ids occupying it]
  const spans = new Map() // col -> [[loLane, hiLane], ...] of the vertical edges drawn IN that column
  const hspans = new Map() // lane -> [[loCol, hiCol], ...] of the HORIZONTAL edges drawn IN that lane
  const isFree = (lane, col) => !occupied.has(`${lane}:${col}`)
  // (a) Would the vertical connector between two lanes jump over a box already in
  //     that column? (b) Would this lane sit UNDER an edge already drawn in that
  //     column? Either way the edge and a box would overlap — advance a column.
  const connectorCrosses = (laneA, laneB, col) => {
    const lo = Math.min(laneA, laneB), hi = Math.max(laneA, laneB)
    for (let L = lo + 1; L < hi; L++) if (occupied.has(`${L}:${col}`)) return true
    return false
  }
  const underExistingEdge = (lane, col) =>
    (spans.get(col) || []).some(([lo, hi]) => lane > lo && lane < hi)
  // The horizontal mirrors of the two rules above. A step flowing to another step
  // in the SAME lane draws a straight horizontal line along that lane, and any box
  // sitting in a column between them is run straight through — the overlap that
  // shows up as an arrow passing behind a shape.
  const rowCrosses = (colA, colB, lane) => {
    const lo = Math.min(colA, colB), hi = Math.max(colA, colB)
    for (let C = lo + 1; C < hi; C++) if (occupied.has(`${lane}:${C}`)) return true
    return false
  }
  const insideExistingRowEdge = (lane, col) =>
    (hspans.get(lane) || []).some(([lo, hi]) => col > lo && col < hi)

  for (const id of order) {
    const lane = laneOf(id)
    const preds = incoming.get(id) || []
    const singlePred = preds.length === 1 ? preds[0] : null
    const stackKey = singlePred != null ? `${singlePred}:${lane}` : null
    let col
    let stacking = false
    const pinned = colOverride(id)
    if (Number.isFinite(pinned)) {
      col = pinned
    } else if (stackKey != null && siblingCol.has(stackKey) &&
               (cellNodes.get(`${lane}:${siblingCol.get(stackKey)}`) || [])
                 .every((o) => (incoming.get(o) || [])[0] === singlePred)) {
      // A sibling of this same predecessor already sits in this lane, and its cell
      // holds only siblings — stack in that same column.
      col = siblingCol.get(stackKey)
      stacking = true
    } else {
      // Base column = the furthest-right predecessor (never sit left of a pred).
      let base = 0
      for (const p of preds) {
        const pc = colOf.get(p)
        if (pc != null) base = Math.max(base, pc)
      }
      const pLane = singlePred != null ? laneOf(singlePred) : null
      // Walk right until the lane is free AND placing here draws no edge over a
      // box: neither this node's own connector crossing a box (a), nor this node
      // landing beneath an edge already routed in the column (b).
      col = base
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (!isFree(lane, col)) { col += 1; continue }
        if (singlePred != null && colOf.get(singlePred) === col && connectorCrosses(pLane, lane, col)) { col += 1; continue }
        if (underExistingEdge(lane, col)) { col += 1; continue }
        // Don't drop this box on top of a horizontal edge already drawn in the lane.
        if (insideExistingRowEdge(lane, col)) { col += 1; continue }
        break
      }
    }
    // When stacking we WANT the sibling's occupied cell; otherwise never overlap.
    if (!stacking) while (occupied.has(`${lane}:${col}`)) col += 1
    occupied.add(`${lane}:${col}`)
    colOf.set(id, col)
    const cellKey = `${lane}:${col}`
    if (!cellNodes.has(cellKey)) cellNodes.set(cellKey, [])
    cellNodes.get(cellKey).push(id)
    if (stackKey != null && !siblingCol.has(stackKey)) siblingCol.set(stackKey, col)
    // Record the span of every edge that ends up alongside this node, so later
    // nodes aren't placed on top of it — vertically (same column, crossing lanes)
    // and horizontally (same lane, crossing columns).
    for (const p of preds) {
      const pc = colOf.get(p)
      if (pc == null) continue
      const a = laneOf(p)
      if (pc === col) {
        if (!spans.has(col)) spans.set(col, [])
        spans.get(col).push([Math.min(a, lane), Math.max(a, lane)])
      }
      if (a === lane && pc !== col) {
        if (!hspans.has(lane)) hspans.set(lane, [])
        hspans.get(lane).push([Math.min(pc, col), Math.max(pc, col)])
      }
    }
  }

  // Repair pass. Placement alone can't prevent every horizontal collision: a step
  // from another branch may already occupy the slot between a node and its
  // successor, and moving the successor further right only lengthens the line over
  // it. So afterwards, find any same-lane edge that runs through a box and push
  // THAT BOX clear of the edge instead. Bounded, and each pass strictly increases
  // the offender's column, so it terminates.
  const byLaneCol = () => {
    const m = new Map()
    for (const [id, c] of colOf) m.set(`${laneOf(id)}:${c}`, id)
    return m
  }
  // Each node may be relocated at most once. Without that cap two branches of the
  // same decision, both landing in the decision's own lane, shove each other
  // rightwards forever — one run pushed a node out to column 123.
  const relocated = new Set()
  for (let pass = 0; pass < 8; pass++) {
    const slot = byLaneCol()
    let moved = false
    for (const id of order) {
      const lane = laneOf(id)
      const col = colOf.get(id)
      for (const p of incoming.get(id) || []) {
        if (laneOf(p) !== lane) continue
        const pc = colOf.get(p)
        if (pc == null || !rowCrosses(pc, col, lane)) continue
        const lo = Math.min(pc, col), hi = Math.max(pc, col)
        for (let C = lo + 1; C < hi; C++) {
          const blocker = slot.get(`${lane}:${C}`)
          if (!blocker || relocated.has(blocker)) continue
          // A sibling branch of the same predecessor can't be shifted out of the
          // way — wherever it goes in this lane, one of the two edges runs over
          // it. Leave those alone rather than pushing them into the far distance.
          const sameParent = (incoming.get(blocker) || []).some((b) => b === p)
          if (sameParent) continue
          // Park the blocker just past the end of the edge that runs over it.
          let target = hi + 1
          while (occupied.has(`${lane}:${target}`)) target += 1
          occupied.delete(`${lane}:${C}`)
          occupied.add(`${lane}:${target}`)
          colOf.set(blocker, target)
          relocated.add(blocker)
          slot.delete(`${lane}:${C}`)
          slot.set(`${lane}:${target}`, blocker)
          moved = true
        }
      }
    }
    if (!moved) break
  }

  // Orphan pull. A step with NO predecessor has nothing to sit right of, so its
  // base column is 0 and it drifts to the far left — miles from the step it
  // actually feeds. Pull it up against its earliest successor instead, so a
  // dangling step reads as part of the flow it joins rather than as a stray box
  // at the start of the board.
  //
  // A real Start needs no special case: its successor is already at column 0-1,
  // so the target column works out no further right than where it sits.
  const outgoing = new Map()
  for (const [id, preds] of incoming) {
    for (const p of preds) {
      if (!outgoing.has(p)) outgoing.set(p, [])
      outgoing.get(p).push(id)
    }
  }
  for (const id of order) {
    if ((incoming.get(id) || []).length) continue
    const succ = outgoing.get(id) || []
    if (!succ.length) continue
    const cols = succ.map((s) => colOf.get(s)).filter((c) => c != null)
    if (!cols.length) continue
    const lane = laneOf(id)
    const cur = colOf.get(id)
    let want = Math.min(...cols) - 1
    while (want > cur && occupied.has(`${lane}:${want}`)) want -= 1
    if (want > cur) {
      occupied.delete(`${lane}:${cur}`)
      occupied.add(`${lane}:${want}`)
      colOf.set(id, want)
    }
  }

  // Close any gaps the repair pass opened, so the board doesn't stretch off to
  // the right with empty columns in the middle.
  const used = [...new Set([...colOf.values()])].sort((a, b) => a - b)
  const compact = new Map(used.map((c, i) => [c, i]))
  for (const [id, c] of colOf) colOf.set(id, compact.get(c))
  return colOf
}

// Re-pack an EXISTING board: keep the lane each node was dragged into, but
// recompute every column from the flow so arrows stop crossing boxes. This is
// what "Tidy & number" needs after you've moved rows around — snapping shapes to
// the columns they happen to sit in preserves the very overlaps you want gone.
//
// Flow order comes from the edges (topological). Nodes the flow doesn't reach,
// and ties, fall back to current position so your left-to-right intent survives.
export function tidyColumns(nodes, edges, laneOfNode) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const { order, incoming } = flowOrder(nodes, edges)
  return packColumns({ order, incoming, laneOf: (id) => laneOfNode(byId.get(id)) })
}

// Start / End belong to the step they touch, not to a lane of their own. A Start
// floating in some unrelated owner's lane reads as "this owner begins the
// process" and is simply wrong — the process begins wherever its first activity
// is owned. So pin each terminator to its neighbour's lane: Start to its first
// successor, End to its last predecessor.
//
// Returns a Map of id -> lane index for the terminators that need moving.
export function terminatorLanes(nodes, edges, laneOf) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const succ = new Map()
  const pred = new Map()
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue
    if (!succ.has(e.source)) succ.set(e.source, [])
    if (!pred.has(e.target)) pred.set(e.target, [])
    succ.get(e.source).push(e.target)
    pred.get(e.target).push(e.source)
  }
  const fixed = new Map()
  for (const n of nodes) {
    if (n.type !== 'startEnd') continue
    // Prefer the successor (a Start); fall back to the predecessor (an End).
    const neighbour = (succ.get(n.id) || [])[0] ?? (pred.get(n.id) || [])[0]
    const other = neighbour != null ? byId.get(neighbour) : null
    if (other && other.type !== 'startEnd') fixed.set(n.id, laneOf(other))
  }
  return fixed
}

export function specToBoard(spec) {
  const specNodes = spec.nodes || []
  const specEdges = spec.edges || []

  // Lanes → labels + id→index map.
  const laneList0 = (spec.lanes && spec.lanes.length ? spec.lanes : [{ id: 'l0', label: 'Process Team' }])
  const rawLabels = laneList0.map((l) => l.label)
  const rawIndex = new Map(laneList0.map((l, i) => [l.id, i]))
  const laneOfRaw0 = (n) => (rawIndex.has(n.lane) ? rawIndex.get(n.lane) : rawLabels.length - 1)
  const pinned0 = terminatorLanes(specNodes, specEdges, laneOfRaw0)
  const laneOfRaw = (n) => (pinned0.has(n.id) ? pinned0.get(n.id) : laneOfRaw0(n))

  // Drop OWNERS WITH NOTHING TO DO. After an edit removes the last step in a lane,
  // an empty owner band lingers and reads as "this role is involved" when it no
  // longer is. A generated/edited map only keeps a lane if a step actually lands in
  // it. (Manual canvas lane edits don't come through here, so a deliberately-empty
  // lane you added by hand is untouched.)
  const usedRaw = new Set(specNodes.map(laneOfRaw))
  const kept = rawLabels.map((_, i) => i).filter((i) => usedRaw.has(i))
  const keepIdx = kept.length ? kept : [rawLabels.length - 1] // never end up with zero lanes
  const remap = new Map(keepIdx.map((old, next) => [old, next]))
  const laneLabels = keepIdx.map((i) => rawLabels[i])
  const laneOf = (n) => remap.get(laneOfRaw(n)) ?? 0

  const byId = new Map(specNodes.map((n) => [n.id, n]))
  // Same chain-following walk the renumbering uses, so a generated map is laid
  // out branch-by-branch rather than interleaving them column by column.
  const { order: topo, incoming } = flowOrder(specNodes, specEdges)

  const colOf = packColumns({
    order: topo,
    incoming,
    laneOf: (id) => laneOf(byId.get(id)),
    colOverride: (id) => byId.get(id)?.col,
  })

  // Expand lanes to fit stacks, exactly like Tidy does — a generated board is NOT
  // always one row per lane. When a branch sends two steps into the SAME lane and
  // column (a decision whose "no" ends the process while its "yes" hands off to
  // another process, both landing in the same owner), a single-row lane crams them
  // on top of each other. Counting the stack per (lane, col) and growing the lane
  // gives each its own row — the spacious, readable default.
  const laneCount = laneLabels.length
  const stacks = new Map()
  for (const n of specNodes) {
    const key = `${laneOf(n)}:${colOf.get(n.id) || 0}`
    stacks.set(key, (stacks.get(key) || 0) + 1)
  }
  const laneRows = Array.from({ length: laneCount }, () => 1)
  for (const [key, count] of stacks) {
    const lane = Number(key.split(':')[0])
    if (lane < laneCount) laneRows[lane] = Math.max(laneRows[lane], count)
  }

  const nodes = []
  const centers = new Map()
  const used = new Map() // `${lane}:${col}` -> next free row
  for (const n of specNodes) {
    let type = SHAPE_MAP[n.type] ? n.type : 'activity'
    // If the model named a system but left the shape plain, upgrade to the
    // System variant so the Sand band actually renders — the system field and the
    // shape are two halves of the same fact and must not disagree.
    if (n.system && type === 'activity') type = 'activitySystem'
    if (n.system && type === 'automatedActivity') type = 'automatedActivitySystem'
    const size = SHAPE_MAP[type].size
    const lane = laneOf(n)
    const col = colOf.get(n.id) || 0
    const key = `${lane}:${col}`
    const row = used.get(key) || 0
    used.set(key, row + 1)
    const cx = colCenterX(col)
    const cy = slotCenterY(laneRows, lane, row)
    centers.set(n.id, { x: cx, y: cy })
    nodes.push({
      id: n.id,
      type,
      position: { x: cx - size.width / 2, y: cy - size.height / 2 },
      data: {
        label: n.label,
        ...(n.numbering ? { numbering: n.numbering } : {}),
        ...(n.description ? { description: n.description } : {}),
        ...(n.input ? { input: n.input } : {}),
        ...(n.output ? { output: n.output } : {}),
        ...(n.duration ? { duration: n.duration } : {}),
        ...(n.system ? { system: n.system } : {}),
      },
      style: { width: size.width, height: size.height },
      zIndex: 3,
    })
  }

  const edges = specEdges
    .filter((e) => centers.has(e.source) && centers.has(e.target))
    .map((e, i) => {
      const [sh, th] = pickHandles(centers.get(e.source), centers.get(e.target))
      return {
        id: `e-${e.source}-${e.target}-${i}`,
        source: e.source,
        target: e.target,
        sourceHandle: sh,
        targetHandle: th,
        label: e.label || undefined,
        type: 'process',
        markerEnd: { type: 'arrowclosed', width: 16, height: 16, color: '#33413c' },
        style: { stroke: '#33413c', strokeWidth: 1.5 },
      }
    })

  return {
    title: spec.title || 'Untitled process',
    laneLabels,
    laneRows, // grown to fit any stacks, so co-lane branches don't collide
    nodes,
    edges,
    // Optional pre-authored gap analysis carried through to the session.
    analysis: Array.isArray(spec.analysis) && spec.analysis.length ? spec.analysis : null,
  }
}

// Steps that never carry a numbering code.
// A referenced process carries the code of the process it POINTS AT, not a step
// number in this one, so it must not consume a number in this process's sequence.
const NO_NUMBER = new Set(['startEnd', 'dataObject', 'database', 'referencedProcess', 'callout'])

// Flow order: a topological walk that FOLLOWS THE CHAIN. After emitting a step we
// continue with one of its own successors if that successor is ready; only when
// the chain dead-ends do we fall back to the left-most step still waiting.
//
// The obvious alternative — plain Kahn, tie-broken by board position — is what
// this replaced, and it numbered badly. Every decision makes several steps ready
// at once, and picking "left-most anywhere on the board" hops between branches,
// so a step and its direct successor end up numbered 02 and 12. Following the
// chain keeps consecutive steps consecutively numbered, which is what a reader of
// the map expects, and it lays out branches one after another instead of
// interleaving them.
export function flowOrder(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const indeg = new Map(nodes.map((n) => [n.id, 0]))
  const out = new Map(nodes.map((n) => [n.id, []]))
  const incoming = new Map(nodes.map((n) => [n.id, []]))
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue
    out.get(e.source).push(e.target)
    incoming.get(e.target).push(e.source)
    indeg.set(e.target, indeg.get(e.target) + 1)
  }
  const pos = (id) => byId.get(id).position || { x: 0, y: 0 }
  const cmp = (a, b) => pos(a).x - pos(b).x || pos(a).y - pos(b).y

  const ready = new Set(nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id))
  const order = []
  const seen = new Set()
  let last = null
  while (ready.size) {
    let pick = null
    if (last) {
      // Stay on the chain: the ready successor of the step we just emitted.
      const succ = (out.get(last) || []).filter((t) => ready.has(t)).sort(cmp)
      if (succ.length) pick = succ[0]
    }
    if (!pick) pick = [...ready].sort(cmp)[0]
    ready.delete(pick)
    if (seen.has(pick)) continue
    seen.add(pick)
    order.push(pick)
    last = pick
    for (const t of out.get(pick) || []) {
      indeg.set(t, indeg.get(t) - 1)
      if (indeg.get(t) <= 0 && !seen.has(t)) ready.add(t)
    }
  }
  // Cycles / unreachable steps: append in board order so nothing is dropped.
  for (const n of [...nodes].sort((a, b) => cmp(a.id, b.id))) if (!seen.has(n.id)) order.push(n.id)
  return { order, incoming }
}

// Re-number the step shapes in FLOW order (topological over the edges, ties
// broken by board position left-to-right then top-to-bottom).
//
// The code scheme comes from the process itself when it has one (see
// lib/processCode.js) — pass `prefix`, e.g. "IFM-RCN-INT-AD-CRN", and every step
// becomes IFM-RCN-INT-AD-CRN-001, -002, … Without an explicit prefix the existing
// codes are used to infer one, so older processes keep their own scheme; a
// process with no numbering at all is left alone rather than being invented for.
export function renumberByFlow(nodes, edges, { prefix: given, width: givenWidth } = {}) {
  const eligible = nodes.filter((n) => !NO_NUMBER.has(n.type))
  if (!eligible.length) return nodes

  let prefix
  let width = givenWidth || 2
  if (given) {
    prefix = given.endsWith('-') ? given : `${given}-`
    width = givenWidth || 3 // structured codes are three digits: -001
  } else {
    // Dominant prefix + width from the existing codes (e.g. "IHP-05" → "IHP-", 2).
    const counts = {}
    for (const n of eligible) {
      const m = /^(.*?)(\d+)\s*$/.exec(n.data?.numbering || '')
      if (m) counts[m[1]] = (counts[m[1]] || 0) + 1
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    if (!top) return nodes // process has no numbering scheme — leave it alone
    prefix = top[0]
    const ex = eligible.find((n) => (n.data?.numbering || '').startsWith(prefix) && /\d+\s*$/.test(n.data?.numbering || ''))
    const wm = ex && /(\d+)\s*$/.exec(ex.data.numbering)
    if (wm) width = wm[1].length
  }

  // Walk the flow chain by chain, so consecutive steps get consecutive codes.
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const { order } = flowOrder(nodes, edges)

  // Assign sequential codes to the numbered steps in that order.
  const rank = new Map()
  let i = 0
  for (const id of order) {
    const n = byId.get(id)
    if (n && !NO_NUMBER.has(n.type)) rank.set(id, ++i)
  }
  return nodes.map((n) => {
    const r = rank.get(n.id)
    if (!r) {
      // A non-numbered shape must not keep a stale step code. The usual culprit is
      // a referenced process that was once numbered as a step (before references
      // started carrying the TARGET's code) — left in the data it reappears as a
      // phantom row in the exported manual.
      if (n.data?.numbering && NO_NUMBER.has(n.type)) {
        const { numbering, ...rest } = n.data
        return { ...n, data: rest }
      }
      return n
    }
    return { ...n, data: { ...n.data, numbering: prefix + String(r).padStart(width, '0') } }
  })
}
