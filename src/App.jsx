import { useCallback, useRef, useState, useEffect, useMemo } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  ConnectionLineType,
  addEdge,
  reconnectEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import Sidebar from './components/Sidebar'
import { nodeTypes, edgeTypes } from './nodes'
import { SHAPE_MAP, DEFAULT_LANES } from './shapes'
import { specToBoard, renumberByFlow, tidyColumns, terminatorLanes, flowOrder } from './lib/layout'
import { mapFromTable, analyzeGaps, fillDetails, groupIntoPhases, renamePhasesFromSteps, generateProcess, editProcess, summarizeProcess, suggestProcessCode } from './lib/ai'
import { boardToSvg } from './lib/exportSvg'
import {
  readMirror, writeMirror, mirrorIsDirty, fetchState, saveState, deleteSessionOnServer,
  createStudio, fetchStudio, renameStudioOnServer, setWorkspacePassword,
  deleteWorkspaceOnServer, unlockWorkspace, wsToken, setWsToken,
  knownWorkspaces, rememberWorkspace, forgetWorkspace,
  readLastStudio, writeLastStudio,
} from './lib/store'
import StudioSwitcher from './components/StudioSwitcher'
import WorkspaceGallery, { UnlockScreen } from './components/WorkspaceGallery'
import ViewBoundary from './components/ErrorBoundary'
import PresenterView from './components/PresenterView'
import { BoardContext } from './context'
import {
  TITLE_H, LANE_H, ROW_H, HEADER_W, COL_W,
  boardWidth, laneCenterY, colCenterX, snapNode, pickHandles,
} from './board'
import {
  rowsOf, laneHeight, laneTop, slotCenterY, slotAtY, reseat, requiredRows,
} from './lib/lanes'
import TableView from './components/TableView'
import GapEditor from './components/GapEditor'
import PhasesView from './components/PhasesView'
import Landing from './components/Landing'
import CommandBar from './components/CommandBar'
import CanvasTools from './components/CanvasTools'
import Portal from './components/Portal'
import Reader from './components/Reader'
import PublishDialog from './components/PublishDialog'
import ProcessCard from './components/ProcessCard'
import { downloadManual } from './lib/exportManual'
import { DRAFT, PUBLISHED, STATUS_LABEL, makeSnapshot, publishState, statusOf, suggestDepartment } from './lib/publish'
import { SEGMENTS, codeFromTitle, codePrefix, prefixFromTitle } from './lib/processCode'
import {
  PHASE_H, phasesOf, collapsedOf, phaseIdOf, newPhaseId, phaseSpans,
  spanX, spanW, ownersOf, foldEdges, separatePhaseColumns, fillPhaseGaps,
} from './lib/phases'
import './App.css'

const ARTIFACT = new Set(['dataObject', 'database']) // hang off the flow, don't advance the chain

const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`

const EDGE_OPTS = {
  type: 'process', // orthogonal, sharp corners + editable label
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#33413c' },
  style: { stroke: '#33413c', strokeWidth: 1.5 },
}

function makeSession(title = 'Untitled process') {
  return { id: uid('proc'), title, laneLabels: [...DEFAULT_LANES], nodes: [], edges: [] }
}

// Node positions are absolute pixels derived from the lane geometry, so when the
// geometry changes every saved board has to be re-seated or its shapes land in
// the wrong lanes. Bump GEOM_V and add the old constants here whenever LANE_H or
// a shape height changes.
const GEOM_V = 3
// How long an archived process is kept before it is really removed.
const ARCHIVE_DAYS = 30

// A stable, render-safe stand-in for "no process" — same shape a real session has,
// so any code that reads active.nodes/laneLabels/etc. is safe even when there is
// genuinely nothing loaded. Module-level so React sees one identity, not a new
// object each render.
const EMPTY_SESSION = {
  id: '__empty__', title: '', laneLabels: ['Process Team'], laneRows: [1],
  nodes: [], edges: [], phases: [], analysis: null,
}
const LANE_H_BY_GEOM = { 1: 104, 2: LANE_H } // lane height each stored version used

function migrateGeometry(store) {
  if (store.geom === GEOM_V) return store
  const from = store.geom || 1
  const prevLaneH = LANE_H_BY_GEOM[from] || LANE_H
  const sessions = (store.sessions || []).map((s) => {
    const laneCount = (s.laneLabels || DEFAULT_LANES).length
    const nodes = (s.nodes || []).map((n) => {
      const size = SHAPE_MAP[n.type]?.size
      if (!size) return n
      // A node's own style is a COPY of the shape's default size, taken when the
      // node was created — there is no resize UI, so it is never anything else.
      // That copy is what React Flow actually renders, so a stale one silently
      // overrides a changed default: decisions kept rendering at the old 100px
      // while everything else moved to the new geometry, leaving them 12px below
      // their lane's centre and putting a kink in every connector into them.
      // Height used for the lane lookup must be the one that was RENDERED.
      const renderedH = n.style?.height ?? size.height
      const cy = (n.position?.y ?? 0) + renderedH / 2
      const lane = Math.max(0, Math.min(laneCount - 1, Math.floor((cy - TITLE_H) / prevLaneH)))
      return {
        ...n,
        style: { ...n.style, width: size.width, height: size.height }, // re-sync to the source of truth
        position: { ...n.position, y: laneCenterY(lane) - size.height / 2 },
      }
    })
    // Everything before variable-height lanes was exactly one row per lane.
    return { ...s, laneRows: s.laneRows || Array.from({ length: laneCount }, () => 1), nodes }
  })
  return { ...store, sessions, geom: GEOM_V }
}

// Self-healing pass, run on EVERY load and deliberately not gated on the version
// stamp. A version marker only records what we *believe* happened; if a board was
// ever marked migrated without actually being migrated (a hot reload stamping the
// new constant onto old data will do it), the board is stranded — the marker says
// "done" so the migration never runs again, and it stays visibly broken forever.
//
// So instead of trusting the stamp, check the data itself: every node's style must
// match the shape defaults it renders from, and every node must sit centred on a
// lane. Both are cheap to verify and idempotent to fix.
function normalizeNodes(store) {
  const sessions = (store.sessions || []).map((s) => {
    const rows = rowsOf(s)
    const nodes = (s.nodes || []).map((n) => {
      const size = SHAPE_MAP[n.type]?.size
      if (!size) return n
      const renderedW = n.style?.width ?? size.width
      const renderedH = n.style?.height ?? size.height
      const cy = (n.position?.y ?? 0) + renderedH / 2
      // Nearest slot centre — lanes may be several rows tall, so this asks the
      // lane model rather than dividing by a constant.
      const slot = slotAtY(rows, cy)
      const wantY = slotCenterY(rows, slot.lane, slot.row) - size.height / 2
      const sized = renderedW === size.width && renderedH === size.height
      if (sized && Math.abs((n.position?.y ?? 0) - wantY) < 0.5) return n
      // A stale WIDTH throws the node off its column centre the same way a stale
      // height throws it off the lane centre — and that horizontal error is what
      // puts a tiny jog in an otherwise straight vertical connector, which reads
      // as a doubled line. Snap back to the nearest column, don't preserve the
      // error. Shapes always sit on column centres (drops snap, ←col/col→ moves
      // by exactly one column), so this never fights a deliberate position.
      const cx = (n.position?.x ?? 0) + renderedW / 2
      const col = Math.max(0, Math.round((cx - HEADER_W - COL_W / 2) / COL_W))
      const wantX = sized ? n.position.x : colCenterX(col) - size.width / 2
      return {
        ...n,
        style: { ...n.style, width: size.width, height: size.height },
        position: { x: wantX, y: wantY },
      }
    })
    return { ...s, laneRows: rows, nodes }
  })
  return { ...store, sessions }
}

// Initial state is a single empty process; the real library is loaded per-studio
// once we know who is signed in and which studio they're in (see the load effect).
// The old "paint from the global mirror on mount" is gone — the mirror is now
// per-studio, and the login gate covers the brief moment before the studio loads.
function loadStore() {
  const s = makeSession()
  return { sessions: [s], activeId: s.id, geom: GEOM_V }
}

// Adopt a persisted (mirror or DB) state blob into the app's shape.
function adoptStore(raw) {
  const healed = normalizeNodes(migrateGeometry(raw))
  const sessions = healed.sessions?.length ? healed.sessions : [makeSession()]
  const activeId = raw.activeId && sessions.some((s) => s.id === raw.activeId) ? raw.activeId : sessions[0].id
  return { sessions, activeId }
}

function boardColsFromNodes(nodes) {
  let max = 0
  for (const n of nodes) {
    const w = n.style?.width || 160
    const col = Math.round((n.position.x + w / 2 - HEADER_W - COL_W / 2) / COL_W)
    if (col > max) max = col
  }
  return max + 2
}

// Where should a shape land, given the lane and column the user aimed at?
//
// A lane holds one shape per (row, column). Aim at a taken slot and we look for a
// free ROW in that lane and column — stacking under the shape that's already
// there — and if every row is taken we GROW the lane by one row. The lane is the
// owner, so it is never changed; the shape never silently overlaps and never
// lands in someone else's lane.
function placeIn(nodes, rows, lane, col, ignoreId) {
  const taken = new Set()
  for (const n of nodes) {
    if (n.id === ignoreId || ARTIFACT.has(n.type)) continue
    const size = sizeOfNode(n)
    if (!size) continue
    const slot = slotAtY(rows, n.position.y + size.height / 2)
    const c = Math.max(0, Math.round((n.position.x + size.width / 2 - HEADER_W - COL_W / 2) / COL_W))
    taken.add(`${slot.lane}:${slot.row}:${c}`)
  }
  const total = rows[lane] || 1
  for (let row = 0; row < total; row++) {
    if (!taken.has(`${lane}:${row}:${col}`)) return { row, rows }
  }
  const grown = rows.slice()
  grown[lane] = total + 1
  return { row: total, rows: grown } // lane expands to make room
}

function nodeCenter(n) {
  const w = n.style?.width ?? SHAPE_MAP[n.type]?.size.width ?? 160
  const h = n.style?.height ?? SHAPE_MAP[n.type]?.size.height ?? 70
  return { x: n.position.x + w / 2, y: n.position.y + h / 2 }
}

// Auto-connect source, position-based (not drop-order) so it survives reloads.
// Tier 1: the nearest flow node to the LEFT in the same row (horizontal — the
// principal axis). Tier 2 (fallback): the nearest predecessor overall — to the
// left, or directly above/below in the same column (a cross-lane vertical link,
// e.g. an activity flowing up to its approval).
const AUTO_MAX_DX = COL_W * 3
const AUTO_MAX_DIST = COL_W * 2.5
function autoConnectSource(nodes, target) {
  const cands = nodes
    .filter((n) => !ARTIFACT.has(n.type)) // artifacts aren't part of the flow chain
    .map((n) => {
      const size = SHAPE_MAP[n.type]?.size || { width: 160, height: 70 }
      const c = { x: n.position.x + size.width / 2, y: n.position.y + size.height / 2 }
      return { id: n.id, center: c, dx: target.x - c.x, dy: target.y - c.y }
    })

  // Tier 1 — nearest same-row node to the left.
  let t1 = null
  let t1dx = Infinity
  for (const c of cands) {
    if (Math.abs(c.dy) > LANE_H * 0.6) continue
    if (c.dx <= 0 || c.dx > AUTO_MAX_DX) continue
    if (c.dx < t1dx) { t1dx = c.dx; t1 = c }
  }
  if (t1) return { id: t1.id, center: t1.center }

  // Tier 2 — nearest predecessor (left, or same-column vertical neighbour).
  let t2 = null
  let t2dist = Infinity
  for (const c of cands) {
    const sameColumn = Math.abs(c.dx) < COL_W * 0.5
    if (!(c.dx > 0 || sameColumn)) continue // never point backwards from the right
    const dist = Math.hypot(c.dx, c.dy)
    if (dist > AUTO_MAX_DIST) continue
    if (dist < t2dist) { t2dist = dist; t2 = c }
  }
  return t2 ? { id: t2.id, center: t2.center } : null
}

// Recompute each edge's source/target handles from current node positions so
// arrows stay orthogonal and adapt (horizontal along a lane, vertical across).
// Edges the user hand-rerouted (data.manual) keep their chosen handles.
function relinkEdges(nodes, edges, lanesArg = DEFAULT_LANES.length) {
  // Accepts either a lane count (all one row) or a laneRows array.
  const rows = Array.isArray(lanesArg) ? lanesArg : Array.from({ length: lanesArg }, () => 1)
  const map = new Map(nodes.map((n) => [n.id, n]))
  const box = (n) => {
    const w = n.style?.width ?? SHAPE_MAP[n.type]?.size.width ?? 160
    const h = n.style?.height ?? SHAPE_MAP[n.type]?.size.height ?? 70
    return { left: n.position.x, right: n.position.x + w, top: n.position.y, bottom: n.position.y + h }
  }
  return edges.map((e) => {
    if (e.data?.manual) return e
    const s = map.get(e.source)
    const t = map.get(e.target)
    if (!s || !t) return e
    const [sh, th] = pickHandles(nodeCenter(s), nodeCenter(t))

    // A step flowing to another step in the SAME lane draws a straight line along
    // that lane. When a third box sits between them the line runs straight through
    // it. The layout packer moves the box out of the way where it can, but it
    // cannot for two branches of one decision that both belong to the same owner —
    // whichever order they take, one branch passes over the other. So route that
    // edge around instead: drop it to the edge of the lane band and back up.
    const sSlot = slotAtY(rows, nodeCenter(s).y)
    const tSlot = slotAtY(rows, nodeCenter(t).y)
    const sLane = sSlot.lane
    const tLane = tSlot.lane
    let detourY = null
    if (sLane === tLane && sSlot.row === tSlot.row) {
      const lo = Math.min(nodeCenter(s).x, nodeCenter(t).x)
      const hi = Math.max(nodeCenter(s).x, nodeCenter(t).x)
      const blocked = nodes.some((n) => {
        if (n.id === s.id || n.id === t.id) return false
        const nSlot = slotAtY(rows, nodeCenter(n).y)
        if (nSlot.lane !== sLane || nSlot.row !== sSlot.row) return false
        const b = box(n)
        return b.right > lo && b.left < hi
      })
      if (blocked) {
        // Hug the row's own boundary — the lower one, or the upper one for the
        // very last row on the board, so the detour never leaves it.
        const rowTop = laneTop(rows, sLane) + sSlot.row * ROW_H
        const last = sLane >= rows.length - 1 && sSlot.row >= (rows[sLane] || 1) - 1
        detourY = last ? rowTop + 6 : rowTop + ROW_H - 6
      }
    }
    const data = { ...(e.data || {}) }
    if (detourY == null) delete data.detourY
    else data.detourY = detourY
    return { ...e, sourceHandle: sh, targetHandle: th, data }
  })
}

// Which lane (index from the top) a node currently sits in. Lanes can be more
// than one row tall, so this walks the heights rather than dividing by a constant.
function laneIndexOf(node, laneCountOrRows) {
  const rows = Array.isArray(laneCountOrRows)
    ? laneCountOrRows
    : Array.from({ length: laneCountOrRows }, () => 1)
  const size = SHAPE_MAP[node.type]?.size || { width: 160, height: 70 }
  return slotAtY(rows, node.position.y + size.height / 2).lane
}
const sizeOfNode = (n) => SHAPE_MAP[n.type]?.size

// Ordered table rows derived from the board — by the # (numbering) first, then
// by board position for rows without a number.
function boardToRows(nodes, laneLabels, rows) {
  return nodes
    .slice()
    .sort((a, b) => {
      const an = a.data?.numbering || ''
      const bn = b.data?.numbering || ''
      if (an && bn) {
        const c = an.localeCompare(bn, undefined, { numeric: true, sensitivity: 'base' })
        if (c) return c
      } else if (an !== bn) {
        return an ? -1 : 1 // numbered rows before un-numbered ones
      }
      return a.position.x - b.position.x || a.position.y - b.position.y
    })
    .map((n) => {
      const lane = laneIndexOf(n, rows || laneLabels.length)
      return { id: n.id, type: n.type, lane, responsibility: laneLabels[lane] ?? '', data: n.data || {} }
    })
}

function Canvas() {
  const { screenToFlowPosition, fitView } = useReactFlow()

  const init = useMemo(loadStore, [])
  // Persist the version the data we are HOLDING was migrated to — not whatever
  // GEOM_V currently says. Stamping the constant would let a hot reload mark
  // un-migrated boards as up to date, so the next load skips the migration and
  // the board stays broken. (This is not hypothetical; it happened here.)
  const [geomV] = useState(init.geom ?? GEOM_V)
  const [sessions, setSessions] = useState(init.sessions)
  const [activeId, setActiveId] = useState(init.activeId)
  // ---- Workspaces (link-shareable, optional password) ----
  const [boot, setBoot] = useState('loading')            // 'loading' | 'gallery' | 'locked' | 'ready'
  const [workspaces, setWorkspaces] = useState([])        // this browser's known workspaces
  const [studioId, setStudioId] = useState(null)
  const [wsName, setWsName] = useState('')                // current workspace name
  const [lockedMeta, setLockedMeta] = useState(null)      // workspace awaiting its password
  const [autoConnect, setAutoConnect] = useState(true)
  const [info, setInfo] = useState(null)
  // Two SPACES, each with its own home — not one home with the library hanging
  // off it. Studio is where authors work; Library is where everyone reads. Naming
  // one of them "Home" made the other look like a page inside it, which is why the
  // top-left home icon and the studio landing were the same thing.
  //   studio  → 'home' (studio landing) → 'map' | 'table' | 'phases'
  //   library → 'library' (gallery)     → 'reader' (read-only)
  const [view, setView] = useState('home')
  const [readerId, setReaderId] = useState(null)
  const [selectMode, setSelectMode] = useState(false) // marquee-select drag vs pan
  const selectedRef = useRef([]) // ids of currently box-selected shape nodes
  const [selectedCount, setSelectedCount] = useState(0)
  const [presenting, setPresenting] = useState(false) // full-screen presenter view
  const [overflow, setOverflow] = useState(false)

  // Never undefined: if sessions is momentarily empty (mid workspace-switch) or
  // activeId points at a session that just vanished, fall back to a stable empty
  // process rather than letting every `active.nodes` in render throw and blank the
  // page. EMPTY_SESSION is module-level so its identity is stable across renders.
  const active = sessions.find((s) => s.id === activeId) || sessions[0] || EMPTY_SESSION

  // ---- undo / redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z) ----
  const stateRef = useRef({ sessions, activeId })
  stateRef.current = { sessions, activeId }
  const pastRef = useRef([])
  const futureRef = useRef([])
  const snapshot = useCallback(() => {
    pastRef.current.push(JSON.stringify(stateRef.current))
    if (pastRef.current.length > 80) pastRef.current.shift()
    futureRef.current = []
  }, [])
  const undo = useCallback(() => {
    if (!pastRef.current.length) return
    futureRef.current.push(JSON.stringify(stateRef.current))
    const prev = JSON.parse(pastRef.current.pop())
    setSessions(prev.sessions)
    setActiveId(prev.activeId)
  }, [])
  const redo = useCallback(() => {
    if (!futureRef.current.length) return
    pastRef.current.push(JSON.stringify(stateRef.current))
    const next = JSON.parse(futureRef.current.pop())
    setSessions(next.sessions)
    setActiveId(next.activeId)
  }, [])
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target
      const tag = (el?.tagName || '').toLowerCase()
      // Let inputs keep their native text undo
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // ---- Persistence (per studio) ----
  const [dbState, setDbState] = useState('loading') // 'loading' | 'saved' | 'saving' | 'offline'
  const loadedRef = useRef(false)  // saving is enabled for the CURRENT studio
  const adoptedRef = useRef(false) // the DB's own state for this studio has been read

  // Commit to a workspace: remember it, load it, put its link in the address bar.
  const enterWorkspace = useCallback((meta, { push = false } = {}) => {
    rememberWorkspace(meta)
    setWorkspaces(knownWorkspaces())
    setStudioId(meta.id)
    setWsName(meta.name || 'Workspace')
    const path = `/s/${meta.id}`
    if (window.location.pathname !== path) {
      window.history[push ? 'pushState' : 'replaceState']({}, '', path)
    }
    setBoot('ready')
  }, [])

  // Boot. The bare domain (`/`) is the GALLERY — the front door listing every
  // workspace. A share link (`/s/<id>`) goes straight to that workspace, via the
  // password screen when it's locked and this browser holds no (valid) token.
  useEffect(() => {
    let cancelled = false
    const fromUrl = (window.location.pathname.match(/^\/s\/([^/]+)/) || [])[1] || null
    if (!fromUrl) { setBoot('gallery'); return }

    ;(async () => {
      let meta = null
      try {
        meta = await fetchStudio(fromUrl) // null == 404 (genuinely gone)
      } catch {
        // NETWORK ERROR — the workspace almost certainly still exists; NEVER
        // abandon a known id on a blip (that once stranded a whole library).
        // Trust the id; the load effect + self-heal loop retry the server.
        const known = knownWorkspaces().find((w) => w.id === fromUrl)
        if (!cancelled) enterWorkspace({ id: fromUrl, name: known?.name || 'Workspace' })
        return
      }
      if (cancelled) return
      if (!meta) { setBoot('gallery'); return } // gone → pick another from the gallery
      // Locked and no token in this browser → ask for the password first. (A stale
      // token surfaces later as a 403, which also routes back to 'locked'.)
      if (meta.locked && !wsToken(meta.id)) { setLockedMeta(meta); setBoot('locked'); return }
      enterWorkspace(meta)
    })()
    return () => { cancelled = true }
  }, [enterWorkspace])

  // Load the current studio's library. Runs whenever the studio changes (including
  // a switch). Paints instantly from that studio's mirror, then reconciles with the
  // DB — unless the mirror is DIRTY (an unsaved change the DB hasn't confirmed),
  // in which case the mirror wins and the save effect flushes it.
  useEffect(() => {
    if (boot !== 'ready' || !studioId) return
    let cancelled = false
    loadedRef.current = false
    adoptedRef.current = false
    setDbState('loading')
    writeLastStudio(studioId)

    const dirty = mirrorIsDirty(studioId)
    const mir = readMirror(studioId)
    if (mir?.sessions?.length) { const a = adoptStore(mir); setSessions(a.sessions); setActiveId(a.activeId) }
    else { const s = makeSession(); setSessions([s]); setActiveId(s.id) }

    fetchState(studioId)
      .then((remote) => {
        if (cancelled) return
        if (!dirty) {
          const a = adoptStore(remote?.sessions?.length ? remote : { sessions: [makeSession()] })
          setSessions(a.sessions); setActiveId(a.activeId)
        }
        adoptedRef.current = true
        loadedRef.current = true
        setDbState('saved')
      })
      .catch((e) => {
        if (cancelled) return
        if (e.status === 403) {
          // Locked out — the token is stale (password changed) or missing. Do NOT
          // treat as offline (that loop would hammer 403s); ask for the password.
          setWsToken(studioId, null)
          setLockedMeta({ id: studioId, name: wsName || 'Workspace' })
          setBoot('locked')
          return
        }
        loadedRef.current = true // run on the mirror; the recovery loop reconciles
        setDbState('offline')
        console.warn('[process-designer] database unavailable —', e.message)
      })
    return () => { cancelled = true }
  }, [boot, studioId])

  const latestState = useRef(null)
  latestState.current = { sessions, activeId, geom: geomV }

  const isPlaceholder = (s) =>
    !s.nodes?.length && !s.edges?.length && (s.title || '').trim() === 'Untitled process'

  // Debounced save, scoped to the current studio. Nothing is written until that
  // studio has finished loading (loadedRef), so a switch can't bleed one studio's
  // library into another's.
  useEffect(() => {
    if (!loadedRef.current || !studioId) return
    const keep = sessions.filter((s) => !isPlaceholder(s))
    const state = { sessions: keep.length ? keep : sessions, activeId, geom: geomV }
    writeMirror(studioId, state, { dirty: true })
    setDbState((s) => (s === 'offline' ? s : 'saving'))
    const t = setTimeout(() => {
      saveState(state, studioId)
        .then(() => { writeMirror(studioId, state, { dirty: false }); setDbState('saved') })
        .catch((e) => {
          if (e.status === 403) {
            setWsToken(studioId, null)
            setLockedMeta({ id: studioId, name: wsName || 'Workspace' })
            setBoot('locked')
            return
          }
          setDbState('offline'); console.warn('[process-designer] save failed —', e.message)
        })
    }, 600)
    return () => clearTimeout(t)
  }, [sessions, activeId, geomV, studioId])

  // Self-healing while the DB is unreachable — retry in the background and flush.
  useEffect(() => {
    if (dbState !== 'offline' || !studioId) return
    let stop = false
    const tick = () => {
      if (stop) return
      const attempt = adoptedRef.current
        ? saveState(latestState.current, studioId)
        : fetchState(studioId).then((remote) => {
            if (remote?.sessions?.length && !mirrorIsDirty(studioId)) {
              const a = adoptStore(remote); setSessions(a.sessions); setActiveId(a.activeId)
            }
            adoptedRef.current = true; loadedRef.current = true
          })
      attempt.then(() => { if (!stop) setDbState('saved') }).catch(() => {})
    }
    const id = setInterval(tick, 3000)
    tick()
    return () => { stop = true; clearInterval(id) }
  }, [dbState, studioId])

  // Open a workspace (switch, or follow a share link). Confirms it exists, then
  // updates the URL so the address bar is always the current workspace's link.
  const openWorkspace = useCallback(async (id) => {
    if (id === studioId) return
    const meta = await fetchStudio(id).catch(() => null)
    if (!meta) { alert('That workspace no longer exists.'); forgetWorkspace(id); setWorkspaces(knownWorkspaces()); return }
    // Locked and this browser has no token for it → the password screen, exactly
    // as if the share link had been opened cold.
    if (meta.locked && !wsToken(meta.id)) { setLockedMeta(meta); setBoot('locked'); return }
    enterWorkspace(meta, { push: true })
  }, [studioId, enterWorkspace])

  // Make a brand-new (empty) workspace and jump into it. Password optional —
  // empty means anyone with the link can enter.
  const makeStudio = useCallback(async (name, password) => {
    const ws = await createStudio(name, password || undefined)
    enterWorkspace(ws, { push: true })
  }, [enterWorkspace])

  const renameStudio = useCallback(async (id, name) => {
    try {
      const meta = await renameStudioOnServer(id, name)
      setWsName(meta.name)
      rememberWorkspace(meta)
      setWorkspaces(knownWorkspaces())
    } catch (e) {
      // A silent failure here once read as "the button does nothing".
      alert(`Could not rename the workspace: ${e.message || e}`)
    }
  }, [])

  // Set / change / clear this workspace's password. Clearing makes it open again.
  const changeWorkspacePassword = useCallback(async (id, password) => {
    try {
      await setWorkspacePassword(id, password)
      alert(password
        ? 'Password set. Everyone opening this workspace now needs it (existing browsers are signed in until the password changes again).'
        : 'Password removed — anyone with the link can enter.')
    } catch (e) {
      alert(`Could not change the password: ${e.message || e}`)
    }
  }, [])

  // Forget this browser's access token for a workspace — the next entry will ask
  // for the password again (if it has one). Useful on a shared computer, and the
  // way to prove the password actually gates access.
  const signOutWorkspace = useCallback((id) => {
    setWsToken(id, null)
    window.location.href = '/'
  }, [])

  // Delete the whole workspace (its processes go with it; revisions stay in the
  // database as the emergency undo). Then back to the gallery.
  const removeWorkspace = useCallback(async (id) => {
    try {
      await deleteWorkspaceOnServer(id)
      forgetWorkspace(id)
      setWsToken(id, null)
      window.location.href = '/'
    } catch (e) {
      alert(`Could not delete the workspace: ${e.message || e}`)
    }
  }, [])

  // Following the browser's back/forward between workspace links.
  useEffect(() => {
    const onPop = () => {
      const id = (window.location.pathname.match(/^\/s\/([^/]+)/) || [])[1]
      if (id && id !== studioId) openWorkspace(id)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [studioId, openWorkspace])

  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 300, minZoom: 0.2 }), 60)
    return () => clearTimeout(t)
  }, [activeId, fitView])

  const patchActive = useCallback(
    (fn) => setSessions((ss) => ss.map((s) => (s.id === activeId ? fn(s) : s))),
    [activeId],
  )

  // Patch a SPECIFIC process. Anything asynchronous must use this with the id it
  // captured when it started: an AI call takes minutes, and patchActive writes to
  // whatever happens to be open when the promise lands — so switching process
  // mid-request would drop the answer into the wrong one.
  const patchSession = useCallback(
    (id, fn) => setSessions((ss) => ss.map((s) => (s.id === id ? fn(s) : s))),
    [],
  )

  // Which processes have a long AI request in flight, so a busy button only
  // disables the process it belongs to instead of every tab at once.
  const [busy, setBusy] = useState({}) // { [sessionId]: 'filling' | 'analyzing' | 'regenerating' }
  const markBusy = useCallback((id, what) => {
    setBusy((b) => (what ? { ...b, [id]: what } : Object.fromEntries(Object.entries(b).filter(([k]) => k !== id))))
  }, [])

  // Every AI action (2-4 minutes) is cancellable. An AbortController per busy key
  // lets a Stop button abort the in-flight fetch; the handler catches the abort and
  // clears busy silently (a deliberate Stop is not an error).
  const aiAborters = useRef({})
  const beginAI = useCallback((key, what) => {
    const ctl = new AbortController()
    aiAborters.current[key] = ctl
    markBusy(key, what)
    return ctl.signal
  }, [markBusy])
  const endAI = useCallback((key) => { delete aiAborters.current[key]; markBusy(key, null) }, [markBusy])
  const stopAI = useCallback((key) => {
    aiAborters.current[key]?.abort()
    delete aiAborters.current[key]
    markBusy(key, null)
  }, [markBusy])

  // ---- shared board callbacks (used by custom nodes) ----
  const setNodeLabel = useCallback(
    (id, label) => {
      if (id === '__title') return patchActive((s) => ({ ...s, title: label }))
      if (id.startsWith('lane-')) {
        const i = Number(id.slice(5))
        return patchActive((s) => {
          const l = [...s.laneLabels]
          l[i] = label
          return { ...s, laneLabels: l }
        })
      }
      patchActive((s) => ({
        ...s,
        nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n)),
      }))
    },
    [patchActive],
  )
  const setNodeSystem = useCallback(
    (id, system) => {
      snapshot()
      patchActive((s) => ({
        ...s,
        nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, system } } : n)),
      }))
    },
    [patchActive, snapshot],
  )
  const setEdgeLabel = useCallback(
    (id, label) => {
      snapshot()
      patchActive((s) => ({
        ...s,
        edges: s.edges.map((e) => (e.id === id ? { ...e, label: label || undefined } : e)),
      }))
    },
    [patchActive, snapshot],
  )
  // ---- editable gap-analysis box: replace the whole set of gaps at once ----
  const setAnalysis = useCallback(
    (gaps) => {
      snapshot()
      patchActive((s) => ({ ...s, analysis: gaps.length ? gaps : null }))
    },
    [patchActive, snapshot],
  )
  // Swap a shape to a different type, keeping its centre and its data.
  const changeNodeType = useCallback(
    (id, newType) => {
      if (!SHAPE_MAP[newType]) return
      snapshot()
      patchActive((s) => {
        const nodes = s.nodes.map((n) => {
          if (n.id !== id) return n
          const oldSize = SHAPE_MAP[n.type]?.size || { width: 160, height: 70 }
          const size = SHAPE_MAP[newType].size
          const cx = n.position.x + oldSize.width / 2
          const cy = n.position.y + oldSize.height / 2
          return {
            ...n,
            type: newType,
            style: { width: size.width, height: size.height },
            position: { x: cx - size.width / 2, y: cy - size.height / 2 },
          }
        })
        return { ...s, nodes, edges: relinkEdges(nodes, s.edges, s.laneLabels.length) }
      })
    },
    [patchActive, snapshot],
  )
  // The gap box is edited in a panel ABOVE the canvas, not inside the node — a
  // control inside React Flow never reliably receives the click.
  const [editingGaps, setEditingGaps] = useState(false)
  const openGapEditor = useCallback(() => setEditingGaps(true), [])

  // Where each bracket sits, derived from its member steps — nothing to keep in
  // sync, because moving a step moves its bracket.
  const spans = useMemo(
    () => phaseSpans(active, active.nodes, (n) => SHAPE_MAP[n.type]?.size),
    [active.phases, active.nodes],
  )

  const togglePhase = useCallback((id) => {
    patchActive((s) => {
      const set = new Set(collapsedOf(s))
      if (set.has(id)) set.delete(id); else set.add(id)
      return { ...s, collapsedPhases: [...set] }
    })
  }, [patchActive])

  const setAllPhases = useCallback((collapse) => {
    patchActive((s) => ({ ...s, collapsedPhases: collapse ? phasesOf(s).map((p) => p.id) : [] }))
  }, [patchActive])

  // Move steps between stages (the board's drag-and-drop). `phaseId: null` sends
  // them back to the ungrouped holding area.
  const assignSteps = useCallback((ids, phaseId) => {
    const set = new Set(ids)
    snapshot()
    patchActive((s) => ({
      ...s,
      nodes: s.nodes.map((n) =>
        set.has(n.id) ? { ...n, data: { ...n.data, phase: phaseId || undefined } } : n),
    }))
  }, [patchActive, snapshot])

  const addPhase = useCallback(() => {
    snapshot()
    patchActive((s) => ({
      ...s,
      phases: [...phasesOf(s), { id: newPhaseId(), label: `Stage ${phasesOf(s).length + 1}` }],
    }))
  }, [patchActive, snapshot])

  // Deleting a stage never deletes steps — they fall back to ungrouped, where they
  // stay visible and can be dragged somewhere else.
  const deletePhase = useCallback((id) => {
    snapshot()
    patchActive((s) => ({
      ...s,
      phases: phasesOf(s).filter((p) => p.id !== id),
      collapsedPhases: (s.collapsedPhases || []).filter((p) => p !== id),
      nodes: s.nodes.map((n) => (n.data?.phase === id ? { ...n, data: { ...n.data, phase: undefined } } : n)),
    }))
  }, [patchActive, snapshot])

  // Move a stage before/after another — the chain's order is the stored order.
  const reorderPhase = useCallback((fromId, toId) => {
    snapshot()
    patchActive((s) => {
      const list = phasesOf(s)
      const from = list.findIndex((p) => p.id === fromId)
      const to = list.findIndex((p) => p.id === toId)
      if (from < 0 || to < 0 || from === to) return s
      const next = [...list]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { ...s, phases: next }
    })
  }, [patchActive, snapshot])

  // Publishing copies the process AS IT STANDS into a snapshot the library reads.
  // The draft keeps evolving afterwards and readers see nothing new until someone
  // publishes again — which is the whole point of having the two sides.
  // Publishing is one action with a confirmation in front of it; the dialog owns
  // the wording and the steps, this just commits what it returns.
  const [publishing, setPublishing] = useState(null)
  const [exportMenu, setExportMenu] = useState(false)
  const [cardOpen, setCardOpen] = useState(false)
  const [refPickerFor, setRefPickerFor] = useState(null)

  // Every process's code and title, for the reference shapes to display and for
  // the picker to list. Built here because a node has no idea other processes
  // exist — it only knows the id it was pointed at.
  const processRefs = useMemo(
    () => new Map(sessions.map((s) => [s.id, { code: prefixOf(s), title: s.title || 'Untitled process' }])),
    [sessions],
  )

  // Double-clicking a reference follows it; if nothing is linked yet, it asks what
  // to link. One gesture, and it does the obvious thing in both states.
  const openProcessRef = useCallback((nodeId) => {
    const n = active.nodes.find((x) => x.id === nodeId)
    const target = n?.data?.refId && sessions.find((x) => x.id === n.data.refId)
    if (target) { setActiveId(target.id); setView('map'); return }
    setRefPickerFor(nodeId)
  }, [active.nodes, sessions])

  const linkProcessRef = useCallback((nodeId, refId) => {
    const target = refId ? sessions.find((x) => x.id === refId) : null
    snapshot()
    patchActive((s) => ({
      ...s,
      nodes: s.nodes.map((n) => (n.id === nodeId
        // The label follows the target's name unless the author has written their
        // own — a reference that says "Full-time hiring process" when it points at
        // something else is worse than one with no label at all.
        ? { ...n, data: { ...n.data, refId: refId || undefined, label: n.data?.label?.trim() || target?.title || '' } }
        : n)),
    }))
    setRefPickerFor(null)
  }, [sessions, patchActive, snapshot])

  // Saving the card renumbers immediately: a code that is not on the shapes is a
  // code nobody uses.
  const saveCard = useCallback((card) => {
    snapshot()
    patchActive((s) => ({
      ...s,
      card,
      nodes: renumberByFlow(s.nodes, s.edges, { prefix: codePrefix(card.code) }),
    }))
  }, [patchActive, snapshot])

  const openPublish = useCallback((id) => {
    const s = sessions.find((x) => x.id === id)
    if (!s) return
    if (!s.nodes.length) { alert('There are no steps to publish yet.'); return }
    setPublishing(id)
  }, [sessions])

  const commitPublish = useCallback((id, { department, summary }) => {
    snapshot()
    patchSession(id, (x) => ({ ...x, publish: { ...(x.publish || {}), ...makeSnapshot(x, { department, summary }) } }))
  }, [patchSession, snapshot])

  // Withdrawing takes it out of the library and leaves the draft alone — the
  // snapshot stays, so publishing again is one click rather than a re-do.
  const withdrawProcess = useCallback((id) => {
    snapshot()
    patchSession(id, (x) => ({ ...x, publish: { ...(x.publish || {}), status: DRAFT } }))
  }, [patchSession, snapshot])

  const recolorPhase = useCallback((id, color) => {
    patchActive((s) => ({ ...s, phases: phasesOf(s).map((p) => (p.id === id ? { ...p, color } : p)) }))
  }, [patchActive])

  const renamePhase = useCallback((id, label) => {
    patchActive((s) => ({ ...s, phases: phasesOf(s).map((p) => (p.id === id ? { ...p, label } : p)) }))
  }, [patchActive])

  // Collapse the gap-analysis box down to its header. It is a big block under the
  // board and you don't always want it in the way — but clearing it outright loses
  // the analysis, so collapsing is the reversible middle.
  const setCalloutTail = useCallback((id, tail) => {
    patchActive((s) => ({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, tail } } : n)) }))
  }, [patchActive])

  const toggleAnalysisCollapsed = useCallback(() => {
    patchActive((s) => ({ ...s, analysisCollapsed: !s.analysisCollapsed }))
  }, [patchActive])

  const aiActionsRef = useRef({})
  const boardCtx = useMemo(
    () => ({ setNodeLabel, setEdgeLabel, changeNodeType, setNodeSystem, setAnalysis, setInfo, openGapEditor, togglePhase, renamePhase, processRefs, openProcessRef, pickProcessRef: setRefPickerFor, toggleAnalysisCollapsed, setCalloutTail, regenerateGaps: () => aiActionsRef.current?.runAnalysis?.(), analysisBusy: busy[activeId] === 'analyzing' }),
    [setNodeLabel, setEdgeLabel, changeNodeType, setNodeSystem, setAnalysis, openGapEditor, togglePhase, renamePhase, processRefs, openProcessRef, toggleAnalysisCollapsed, setCalloutTail],
  )

  // ---- structural nodes (title bar + lanes) derived from board state ----
  const structureNodes = useMemo(() => {
    const w = boardWidth(boardColsFromNodes(active.nodes))
    const common = { draggable: false, selectable: false, connectable: false, deletable: false }
    // Title + full-width lane bands are click-through (pointer-events:none) so the
    // canvas pans over them; they sit at zIndex 1. The small left header nodes are
    // fully interactive (their owner-name input must be clickable) at zIndex 2.
    // Activity nodes render above everything at zIndex 3.
    const title = {
      id: '__title', type: 'processTitle', position: { x: 0, y: 0 },
      data: { label: active.title }, style: { width: w, height: TITLE_H, pointerEvents: 'none' }, zIndex: 1, ...common,
    }
    const structure = [title]
    const rows = rowsOf(active)
    active.laneLabels.forEach((label, i) => {
      const h = laneHeight(rows, i) // a lane is as tall as the rows it holds
      structure.push({
        id: `band-${i}`, type: 'laneBand', position: { x: 0, y: laneTop(rows, i) },
        data: { index: i }, style: { width: w, height: h, pointerEvents: 'none' }, zIndex: 1, ...common,
      })
      structure.push({
        id: `lane-${i}`, type: 'lane', position: { x: 0, y: laneTop(rows, i) },
        data: { label, index: i }, style: { width: HEADER_W, height: h }, zIndex: 2, ...common,
      })
    })
    const laneBottom = laneTop(rows, active.laneLabels.length)

    // Gap-analysis box directly under the board (display-only, click-through).
    // "Hide gaps" removes the whole box, not just its text — so when collapsed we
    // simply don't add the node. "Show gaps" in the dock brings it back.
    if (active.analysis?.length && !active.analysisCollapsed) {
      structure.push({
        id: '__analysis', type: 'analysisBox',
        position: { x: 0, y: laneBottom + 28 },
        data: { gaps: active.analysis },
        style: { width: w }, zIndex: 1, ...common,
      })
    }
    return structure
  }, [active.title, active.laneLabels, active.laneRows, active.nodes, active.analysis, active.analysisCollapsed])

  const renderedNodes = useMemo(() => [...structureNodes, ...active.nodes], [structureNodes, active.nodes])
  // Render every edge through the custom (labellable) edge type, even older ones
  // saved before this existed — display only, never mutates stored data.
  const renderedEdges = useMemo(
    () => active.edges.map((e) => (e.type === 'process' ? e : { ...e, type: 'process' })),
    [active.edges],
  )

  const onNodesChange = useCallback(
    (changes) => {
      if (changes.some((c) => c.type === 'remove')) snapshot()
      patchActive((s) => ({ ...s, nodes: applyNodeChanges(changes, s.nodes) }))
    },
    [patchActive, snapshot],
  )
  const onEdgesChange = useCallback(
    (changes) => patchActive((s) => ({ ...s, edges: applyEdgeChanges(changes, s.edges) })),
    [patchActive],
  )
  const onConnect = useCallback(
    (params) => patchActive((s) => ({ ...s, edges: addEdge({ ...EDGE_OPTS, ...params }, s.edges) })),
    [patchActive],
  )
  // Reroute an existing edge: drag its endpoint onto a different handle. Mark it
  // "manual" so auto-relink leaves the chosen routing alone afterwards.
  const onReconnect = useCallback(
    (oldEdge, newConnection) => {
      snapshot()
      patchActive((s) => ({
        ...s,
        edges: reconnectEdge(oldEdge, newConnection, s.edges, { shouldReplaceId: false }).map((e) =>
          e.id === oldEdge.id ? { ...e, data: { ...(e.data || {}), manual: true } } : e,
        ),
      }))
    },
    [patchActive, snapshot],
  )

  const onDragOver = useCallback((e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e) => {
      e.preventDefault()
      const type = e.dataTransfer.getData('application/pd-shape')
      if (!type || !SHAPE_MAP[type]) return
      const shape = SHAPE_MAP[type]
      const size = shape.size
      const raw = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const id = uid(type)
      snapshot()
      patchActive((s) => {
        const rows = rowsOf(s)
        const aim = slotAtY(rows, raw.y)
        const col = Math.max(0, Math.round((raw.x - HEADER_W - COL_W / 2) / COL_W))
        const data = { ...shape.defaultData }
        // First Start/End is a "Start"; the next one defaults to "End".
        if (type === 'startEnd' && s.nodes.some((n) => n.type === 'startEnd')) data.label = 'End'
        // Stack into a free row of the lane you aimed at, growing it if need be.
        const placed = placeIn(s.nodes, rows, aim.lane, col)
        const cx = colCenterX(col)
        const cy = slotCenterY(placed.rows, aim.lane, placed.row)
        const newNode = {
          id, type,
          position: { x: cx - size.width / 2, y: cy - size.height / 2 },
          data,
          style: { width: size.width, height: size.height },
          zIndex: 3,
        }
        // Growing a lane pushes every lane below it down.
        const existing = placed.rows === rows ? s.nodes : reseat(s.nodes, rows, placed.rows, sizeOfNode)
        const nodes = [...existing, newNode]
        let edges = s.edges
        const src = autoConnect ? autoConnectSource(existing, { x: cx, y: cy }) : null
        if (src) {
          const [sh, th] = pickHandles(src.center, { x: cx, y: cy })
          edges = addEdge({ ...EDGE_OPTS, source: src.id, target: id, sourceHandle: sh, targetHandle: th }, edges)
        }
        return { ...s, laneRows: placed.rows, nodes, edges: relinkEdges(nodes, edges, placed.rows) }
      })
    },
    [screenToFlowPosition, active.laneLabels.length, autoConnect, patchActive, snapshot],
  )

  const onNodeDragStart = useCallback(() => snapshot(), [snapshot])

  const onNodeDragStop = useCallback(
    (e, node) => {
      // A callout is an annotation floating ABOVE the board, not a step that owns a
      // lane slot: it may sit anywhere, span lanes and columns, and must keep the
      // exact position you dropped it at. Everything else snaps to its lane row.
      if (node.type === 'lane' || node.type === 'processTitle' || node.type === 'callout') return
      const size = SHAPE_MAP[node.type]?.size || { width: node.width || 160, height: node.height || 70 }
      patchActive((s) => {
        const rows = rowsOf(s)
        const cy0 = node.position.y + size.height / 2
        const aim = slotAtY(rows, cy0)
        const col = Math.max(0, Math.round((node.position.x + size.width / 2 - HEADER_W - COL_W / 2) / COL_W))
        // Same rule as dropping: the lane you dragged into is kept, the shape
        // stacks into a free row there, and the lane grows if it has to.
        const placed = placeIn(s.nodes, rows, aim.lane, col, node.id)
        const pos = {
          x: colCenterX(col) - size.width / 2,
          y: slotCenterY(placed.rows, aim.lane, placed.row) - size.height / 2,
        }
        const base = placed.rows === rows ? s.nodes : reseat(s.nodes, rows, placed.rows, sizeOfNode)
        const nodes = base.map((n) => (n.id === node.id ? { ...n, position: pos } : n))
        return { ...s, laneRows: placed.rows, nodes, edges: relinkEdges(nodes, s.edges, placed.rows) }
      })
    },
    [patchActive],
  )

  // ---- session + lane operations ----
  const newProcess = () => {
    snapshot()
    const s = makeSession()
    setSessions((ss) => [...ss, s])
    setActiveId(s.id)
  }
  const deleteProcess = (id) => {
    snapshot()
    setSessions((ss) => {
      if (ss.length <= 1) return ss
      const next = ss.filter((s) => s.id !== id)
      if (id === activeId) setActiveId(next[0].id)
      // Removal must be explicit — an ordinary save never deletes (see store.js).
      // The revisions stay in the database, so this is still recoverable.
      deleteSessionOnServer(id, studioId)
      return next
    })
  }

  // ---- Archive -------------------------------------------------------------
  // Deleting a process outright is the thing people are most afraid of doing by
  // accident, so Archive is the safe default: the process leaves the working list
  // but stays whole for ARCHIVE_DAYS, visible in its own section, one click from
  // being restored. Only after it expires is it actually removed (and even then
  // the DB keeps its revisions).
  const archiveProcess = useCallback((id) => {
    snapshot()
    patchSession(id, (s) => ({ ...s, archivedAt: new Date().toISOString() }))
    setSessions((ss) => {
      const live = ss.filter((s) => s.id !== id && !s.archivedAt)
      if (id === activeId && live.length) setActiveId(live[0].id)
      return ss
    })
  }, [patchSession, snapshot, activeId])

  const restoreProcess = useCallback((id) => {
    snapshot()
    patchSession(id, (s) => { const { archivedAt, ...rest } = s; return rest })
  }, [patchSession, snapshot])

  // Purge anything whose 30 days are up. Runs once the studio's library is loaded.
  useEffect(() => {
    if (!loadedRef.current || !studioId) return
    const cutoff = Date.now() - ARCHIVE_DAYS * 864e5
    const expired = sessions.filter((s) => s.archivedAt && new Date(s.archivedAt).getTime() < cutoff)
    if (!expired.length) return
    for (const s of expired) deleteSessionOnServer(s.id, studioId)
    setSessions((ss) => ss.filter((s) => !expired.some((e) => e.id === s.id)))
  }, [sessions, studioId])
  // A callout is dropped into the middle of what you're looking at, not snapped to
  // a lane slot: it annotates the map rather than occupying a step's place in it.
  const addCallout = useCallback(() => {
    const shape = SHAPE_MAP.callout
    // Centre of the CANVAS, not the window: the sidebar and toolbar take up a big
    // slice of the window, and when the board is panned the window centre can map
    // to a point far off the board (the first version dropped callouts at negative
    // coordinates you then had to hunt for).
    // NB: .react-flow__pane measures 0x0 (it's an event overlay), so use the
    // react-flow ROOT, which has the real viewport dimensions.
    const pane = document.querySelector('.react-flow') || document.querySelector('.pd-canvas-body')
    const r = pane?.getBoundingClientRect()
    const c = screenToFlowPosition && r
      ? screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      : { x: 400, y: 200 }
    snapshot()
    patchActive((s) => ({
      ...s,
      nodes: [...s.nodes, {
        id: uid('n'),
        type: 'callout',
        position: { x: Math.round(c.x - shape.size.width / 2), y: Math.round(c.y - shape.size.height / 2) },
        data: { ...shape.defaultData },
        style: { width: shape.size.width, height: shape.size.height },
        zIndex: 20, // above every lane band and step
      }],
    }))
  }, [patchActive, snapshot, screenToFlowPosition])

  const setTitle = (t) => patchActive((s) => ({ ...s, title: t }))

  // Lanes grow from the TOP: a new lane is inserted above the rest, and every
  // existing node shifts down one lane so it stays with its owner. Numbering in
  // the sidebar runs bottom-to-top (the bottom "doing" lane is #1).
  const addLane = () => {
    snapshot()
    patchActive((s) => {
      const nodes = s.nodes.map((n) => ({ ...n, position: { ...n.position, y: n.position.y + ROW_H } }))
      return {
        ...s,
        laneLabels: [`Role ${s.laneLabels.length + 1}`, ...s.laneLabels],
        laneRows: [1, ...rowsOf(s)],
        nodes,
      }
    })
  }
  const removeLane = () => removeLaneAt(0) // toolbar "− Lane" drops the top lane
  // Delete ANY lane by index: lanes above stay put, the deleted lane's own steps
  // move to the nearest surviving lane, and lanes below shift up one row.
  const removeLaneAt = (i) => {
    snapshot()
    patchActive((s) => {
      if (s.laneLabels.length <= 1) return s
      const rows = rowsOf(s)
      const laneLabels = s.laneLabels.filter((_, idx) => idx !== i)
      const laneRows = rows.filter((_, idx) => idx !== i)
      const newCount = laneLabels.length
      const nodes = s.nodes.map((n) => {
        const size = SHAPE_MAP[n.type]?.size || { width: 160, height: 70 }
        const slot = slotAtY(rows, n.position.y + size.height / 2)
        const nl = slot.lane < i ? slot.lane : slot.lane === i ? Math.min(i, newCount - 1) : slot.lane - 1
        return { ...n, position: { ...n.position, y: slotCenterY(laneRows, nl, slot.row) - size.height / 2 } }
      })
      return { ...s, laneLabels, laneRows, nodes, edges: relinkEdges(nodes, s.edges, laneRows) }
    })
  }
  const renameLane = (i, label) =>
    patchActive((s) => {
      const l = [...s.laneLabels]
      l[i] = label
      return { ...s, laneLabels: l }
    })
  // Drag a lane to a new position; nodes follow their owner to the new row.
  const reorderLane = (from, to) => {
    if (from === to || from == null || to == null) return
    snapshot()
    patchActive((s) => {
      const order = s.laneLabels.map((_, i) => i) // order[newIndex] = oldIndex
      const [moved] = order.splice(from, 1)
      order.splice(to, 0, moved)
      const rows = rowsOf(s)
      const laneLabels = order.map((oldIdx) => s.laneLabels[oldIdx])
      const laneRows = order.map((oldIdx) => rows[oldIdx])
      const oldToNew = {}
      order.forEach((oldIdx, newIdx) => { oldToNew[oldIdx] = newIdx })
      const nodes = s.nodes.map((node) => {
        const size = SHAPE_MAP[node.type]?.size || { width: 160, height: 70 }
        const slot = slotAtY(rows, node.position.y + size.height / 2)
        const newLane = oldToNew[slot.lane]
        return { ...node, position: { ...node.position, y: slotCenterY(laneRows, newLane, slot.row) - size.height / 2 } }
      })
      return { ...s, laneLabels, laneRows, nodes, edges: relinkEdges(nodes, s.edges, laneRows) }
    })
  }

  // ---- table view: edit node fields, responsibility (lane), rows ----
  const updateNodeData = useCallback(
    (id, patch) =>
      patchActive((s) => ({
        ...s,
        nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      })),
    [patchActive],
  )
  const setNodeResponsibility = useCallback(
    (id, laneIndex) =>
      patchActive((s) => {
        const rows = rowsOf(s)
        const moving = s.nodes.find((n) => n.id === id)
        if (!moving) return s
        const size = SHAPE_MAP[moving.type]?.size || { width: 160, height: 70 }
        const col = Math.max(0, Math.round((moving.position.x + size.width / 2 - HEADER_W - COL_W / 2) / COL_W))
        const placed = placeIn(s.nodes, rows, laneIndex, col, id)
        const base = placed.rows === rows ? s.nodes : reseat(s.nodes, rows, placed.rows, sizeOfNode)
        const nodes = base.map((n) =>
          n.id === id
            ? { ...n, position: { ...n.position, y: slotCenterY(placed.rows, laneIndex, placed.row) - size.height / 2 } }
            : n,
        )
        return { ...s, laneRows: placed.rows, nodes, edges: relinkEdges(nodes, s.edges, placed.rows) }
      }),
    [patchActive],
  )
  const addRow = useCallback(() => {
    snapshot()
    patchActive((s) => {
      const size = SHAPE_MAP.activity.size
      const maxCol = boardColsFromNodes(s.nodes) - 2 // last used column
      const col = Math.max(0, maxCol) + (s.nodes.length ? 1 : 0)
      const lane = s.laneLabels.length - 1 // bottom "doing" lane
      const cx = HEADER_W + col * COL_W + COL_W / 2
      const cy = slotCenterY(rowsOf(s), lane, 0)
      const id = uid('activity')
      const newNode = {
        id, type: 'activity',
        position: { x: cx - size.width / 2, y: cy - size.height / 2 },
        data: { label: 'New activity' },
        style: { width: size.width, height: size.height },
        zIndex: 3,
      }
      return { ...s, nodes: [...s.nodes, newNode] }
    })
  }, [patchActive, snapshot])
  const deleteRow = useCallback(
    (id) => {
      snapshot()
      patchActive((s) => ({
        ...s,
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      }))
    },
    [patchActive, snapshot],
  )

  // The board, back in the AI's spec shape, so "Update current map" can hand the
  // model exactly what's on the canvas. Lane ids are positional (l0 = top lane).
  const currentSpec = useCallback(() => specOf(active), [active])

  // A freshly GENERATED process opens as its own new session — generating must
  // never destroy the map you were looking at. Editing the current map (or
  // rebuilding it from the table) patches the active session in place.
  // onGenerated is declared below; a ref lets these reach it without reordering
  // the whole component around a landing-page detail.
  const onGeneratedRef = useRef(null)

  // Landing-page actions.
  const landingGenerate = useCallback(async (prompt) => {
    const signal = beginAI('__landing__', 'generating')
    try {
      const spec = await generateProcess({ prompt, signal })
      onGeneratedRef.current(spec, { asNew: true })
      setView('map')
    } catch (e) {
      if (!e?.aborted) alert(e.message || String(e))
    } finally {
      endAI('__landing__')
    }
  }, [beginAI, endAI])

  const landingImport = useCallback((spec) => {
    onGeneratedRef.current(spec, { asNew: true })
    setView('map')
  }, [])

  const landingBlank = useCallback(() => {
    snapshot()
    const s = makeSession()
    setSessions((ss) => [...ss, s])
    setActiveId(s.id)
    setView('map')
  }, [snapshot])

  const onGenerated = useCallback(
    // `sessionId` pins the result to the process the request STARTED from — an AI
    // call takes minutes and the user may well have switched away by now.
    (spec, { asNew = false, sessionId } = {}) => {
      snapshot()
      const board = specToBoard(spec)
      if (asNew) {
        const s = {
          ...makeSession(board.title || 'Generated process'),
          laneLabels: board.laneLabels.length ? board.laneLabels : [...DEFAULT_LANES],
          laneRows: board.laneRows,
          nodes: board.nodes,
          edges: board.edges,
          analysis: board.analysis || null,
        }
        setSessions((ss) => [...ss, s])
        setActiveId(s.id)
      } else {
        // An AI edit returns a fresh spec, so the board comes back re-laid-out but
        // NOT tidied to our rules: the model's numbering is a guess, and specToBoard
        // does not carry phase membership. Left alone, codes drift out of flow order
        // and every step falls out of its stage. So the edit path finishes the job
        // the same way the Tidy button would — renumber in flow order under the
        // process's own code, and re-attach each surviving step to the stage it was
        // already in (matched by id, which editProcess preserves for kept steps).
        const patch = (s) => {
          // Carry each surviving step's stage across the edit. Match by id first;
          // fall back to the step's label, because the model is only ASKED to keep
          // ids and sometimes re-keys the whole spec — in which case id-matching
          // would drop every step out of its stage ("phases entirely messed up").
          // editProcess preserves untouched labels verbatim, so the label is the
          // reliable anchor. A deleted step simply isn't in the new board, so it
          // drops out of its stage on its own without disturbing the others.
          const byId = new Map((s.nodes || []).map((n) => [n.id, n.data?.phase]))
          const byLabel = new Map((s.nodes || [])
            .filter((n) => n.data?.label && n.data?.phase)
            .map((n) => [n.data.label.trim(), n.data.phase]))
          const carried = board.nodes.map((n) => {
            const ph = byId.get(n.id) ?? byLabel.get((n.data?.label || '').trim())
            return ph ? { ...n, data: { ...n.data, phase: ph } } : n
          })

          // Did the stage grouping SURVIVE the edit? The carry fails badly when the
          // model re-keys ids AND rewrites labels — only a handful of steps match,
          // often all in the last stage. Fill-propagating that is the "everything in
          // Stage 5" bug. So: if the grouping is still intact, FINISH it (slot the
          // genuinely-new steps into their neighbour's stage). If it collapsed, DROP
          // the stale grouping — a clean "not grouped" beats a fake one — and let the
          // user re-run Group into phases for a correct one.
          const definedStages = (s.phases || []).length
          const stepsG = carried.filter((n) => n.type !== 'startEnd')
          const assigned = stepsG.filter((n) => n.data?.phase)
          const stagesWithMembers = new Set(assigned.map((n) => n.data.phase)).size
          const intact = definedStages < 2 ||
            (stagesWithMembers >= Math.ceil(definedStages / 2) && assigned.length >= stepsG.length * 0.5)

          const grouped = intact
            ? fillPhaseGaps(carried, flowOrder(board.nodes, board.edges).order)
            : carried.map((n) => (n.data?.phase ? { ...n, data: { ...n.data, phase: undefined } } : n))
          const nodes = renumberByFlow(grouped, board.edges, { prefix: prefixOf(s) })
          return {
            ...s,
            title: board.title || s.title,
            laneLabels: board.laneLabels.length ? board.laneLabels : s.laneLabels,
            laneRows: board.laneRows,
            nodes,
            edges: board.edges,
            phases: intact ? s.phases : [],
            collapsedPhases: intact ? s.collapsedPhases : [],
            analysis: board.analysis || null, // always replace, so a stale box can't linger
          }
        }
        if (sessionId) patchSession(sessionId, patch)
        else patchActive(patch)
      }
      // Don't yank the view around if the user has moved to another process.
      if (!sessionId || sessionId === stateRef.current.activeId) {
        setView('map')
        setTimeout(() => fitView({ padding: 0.15, duration: 400, minZoom: 0.2 }), 80)
      }
    },
    [patchActive, patchSession, fitView, snapshot],
  )

  onGeneratedRef.current = onGenerated

  // Loading an example opens it as its OWN new process session, so it never
  // overwrites the steps in whatever process is currently active.

  const clearAll = () => {
    if (active.nodes.length && !confirm('Clear all steps in this process?')) return
    snapshot()
    patchActive((s) => ({ ...s, nodes: [], edges: [] }))
  }

  // ---- marquee selection + shift a whole block of steps by a column ----
  const onSelectionChange = useCallback(({ nodes: sel }) => {
    const ids = (sel || []).map((n) => n.id)
    selectedRef.current = ids
    setSelectedCount(ids.length)
  }, [])

  // Move every currently box-selected shape one column left/right, so you can
  // open up space for manual adjustments. Re-routes the affected arrows.
  const moveSelectedByColumn = useCallback(
    (dir) => {
      const ids = new Set(selectedRef.current)
      if (!ids.size) return
      snapshot()
      patchActive((s) => {
        const nodes = s.nodes.map((n) =>
          ids.has(n.id) ? { ...n, position: { ...n.position, x: n.position.x + dir * COL_W } } : n,
        )
        return { ...s, nodes, edges: relinkEdges(nodes, s.edges, s.laneLabels.length) }
      })
    },
    [patchActive, snapshot],
  )

  // Re-space every shape onto a clean, roomy grid (columns clustered from their
  // current x, snapped to lane centres), re-route the arrows, AND re-number the
  // steps in flow order (so manual edits / new shapes get the right codes).
  const tidyLayout = () => {
    snapshot()
    patchActive((s) => {
      const laneCount = s.laneLabels.length
      const rows = rowsOf(s)
      // Keep the lane each shape was dragged into; recompute the COLUMNS from the
      // flow with the same collision rules the AI layout uses, so arrows stop
      // running over boxes after a round of manual dragging.
      const draggedLane = (n) => slotAtY(rows, n.position.y + (sizeOfNode(n)?.height ?? 70) / 2).lane
      // The one lane tidy DOES change: Start/End follow the step they connect to.
      // A Start marooned in an unrelated owner's lane claims that owner begins the
      // process. Every other shape keeps the lane you put it in.
      const pinned = terminatorLanes(s.nodes, s.edges, draggedLane)
      const laneOfNode = (n) => (pinned.has(n.id) ? pinned.get(n.id) : draggedLane(n))
      const colOf = tidyColumns(s.nodes, s.edges, laneOfNode)

      // Tidy re-packs into columns, so nothing needs to be stacked any more:
      // every lane collapses back to the rows it actually requires. This is how a
      // lane that grew during editing shrinks again.
      const stacks = new Map()
      for (const n of s.nodes) {
        const key = `${laneOfNode(n)}:${colOf.get(n.id) ?? 0}`
        stacks.set(key, (stacks.get(key) || 0) + 1)
      }
      const laneRows = Array.from({ length: laneCount }, () => 1)
      for (const [key, count] of stacks) {
        const lane = Number(key.split(':')[0])
        if (lane < laneCount) laneRows[lane] = Math.max(laneRows[lane], count)
      }

      const used = new Map() // `${lane}:${col}` -> next free row
      const placed = s.nodes.map((n) => {
        const size = sizeOfNode(n) || { width: 160, height: 70 }
        const lane = laneOfNode(n)
        const col = colOf.get(n.id) ?? 0
        const key = `${lane}:${col}`
        const row = used.get(key) || 0
        used.set(key, row + 1)
        return {
          ...n,
          position: {
            x: colCenterX(col) - size.width / 2,
            y: slotCenterY(laneRows, lane, row) - size.height / 2,
          },
        }
      })
      // The step code is derived from the TITLE (IFM-RCN-INT-AD-CRN), so renaming
      // a process re-codes it — nothing to fill in by hand.
      const nodes = renumberByFlow(placed, s.edges, { prefix: prefixOf(s) })
      return { ...s, laneRows, nodes, edges: relinkEdges(nodes, s.edges, laneRows) }
    })
  }

  // Export the board as a JPEG. We render the whole swim-lane board (title bar,
  // lane headers/bands, every shape, edges and the analysis box) to a standalone
  // SVG built straight from the data — so the image is exactly what's on the
  // canvas — then rasterise that SVG onto a canvas. Native SVG only (no
  // foreignObject), so it renders reliably.
  const [exporting, setExporting] = useState(false)
  const exportImage = useCallback(async () => {
    if (!active.nodes.length) { alert('Nothing to export yet — add some steps first.'); return }
    setExporting(true)
    try {
      // No background → transparent PNG (blends into a doc/slide, like a screenshot).
      const svg = boardToSvg({
        title: active.title,
        laneLabels: active.laneLabels,
        laneRows: rowsOf(active),
        nodes: active.nodes,
        edges: active.edges,
        analysis: active.analysis,
      })
      const m = svg.match(/width="(\d+)" height="(\d+)"/)
      const w = m ? +m[1] : 1200
      const h = m ? +m[2] : 800
      const scale = 2 // retina-sharp
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      const img = new Image()
      const dataUrl = await new Promise((resolve, reject) => {
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = w * scale
          canvas.height = h * scale
          const ctx = canvas.getContext('2d')
          // Leave the canvas cleared (transparent); just scale + draw the SVG.
          ctx.scale(scale, scale)
          ctx.drawImage(img, 0, 0)
          resolve(canvas.toDataURL('image/png'))
        }
        img.onerror = () => reject(new Error('SVG could not be rasterised'))
        img.src = url
      })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `${(active.title || 'process').replace(/[^\w-]+/g, '_')}.png`
      a.click()
    } catch (e) {
      alert('Could not export image: ' + (e.message || String(e)))
    } finally {
      setExporting(false)
    }
  }, [active.nodes.length, active.title, active.laneLabels, active.nodes, active.edges, active.analysis])

  // The procedure table lists work steps only — start/end events, data objects
  // and stores live on the map, not in the table.
  const rows = useMemo(
    () =>
      boardToRows(active.nodes, active.laneLabels, rowsOf(active))
        .filter(
          // A callout is an annotation, not a step — it never belongs in the
          // procedure table (nor do start/end or data artefacts).
          (r) => !['startEnd', 'dataObject', 'database', 'callout'].includes(r.type),
        )
        .map((r) => {
          // A referenced process shows the code of the process it POINTS AT, not a
          // stale step number left in its data — same as the box does on the map.
          if (r.type !== 'referencedProcess') return r
          const code = r.data?.refId ? processRefs.get(r.data.refId)?.code : ''
          return { ...r, data: { ...r.data, numbering: code || '' } }
        }),
    [active.nodes, active.laneLabels, processRefs],
  )

  // Presenter view: two aligned SVGs (fixed owner column + scrollable body),
  // rebuilt only while presenting.

  useEffect(() => {
    if (!presenting) return
    const onKey = (e) => { if (e.key === 'Escape') setPresenting(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [presenting])

  // Re-write each step's description / input / output / duration from the map as
  // it now stands. Editing the picture is quick; keeping the write-up in step with
  // it is not, so these fields go stale after every change.
  //
  // Scoped to the process it was started from: the id and the spec are captured up
  // front, the result is written back with patchSession, and only that process's
  // button shows as busy. You can start a fill, switch to another process and work
  // there — including starting its own fill — and each lands where it belongs.
  const runFillDetails = useCallback(async () => {
    if (!rows.length) { alert('Add some steps to the process first.'); return }
    const HAS = (v) => v && v.trim() && v.trim() !== '-'
    const written = rows.filter((r) => HAS(r.data.description) || HAS(r.data.input) || HAS(r.data.output))
    // One dialog, two honest choices — never silently overwrite text they typed.
    const blanks = rows.length - written.length
    const overwrite = written.length
      ? confirm(
          `"${active.title}": ${written.length} of ${rows.length} steps already have details, ` +
          `${blanks} ${blanks === 1 ? 'is' : 'are'} blank.\n\n` +
          'OK — REWRITE ALL of them to match the current map (replaces what you wrote).\n' +
          `Cancel — only fill the ${blanks} blank one${blanks === 1 ? '' : 's'}.`,
        )
      : false
    // The commonest confusing outcome: they picked "only fill the blanks" on a
    // process that has none, so the button does its job and visibly nothing
    // happens. Say so up front instead of letting it look broken.
    if (!overwrite && blanks === 0) {
      alert(
        `Nothing to fill in "${active.title}" — every step already has details and you chose ` +
        '"only fill the blanks".\n\nRun it again and pick OK to rewrite them from the current map.',
      )
      return
    }
    const sid = activeId
    const title = active.title
    const spec = currentSpec()
    const signal = beginAI(sid, 'filling')
    try {
      let result
      try {
        result = await fillDetails({ spec, onlyBlank: !overwrite, signal })
      } catch (e) {
        if (!e?.aborted) alert(`Could not fill the details in "${title}": ${e.message || e}`)
        return
      }
      const byId = new Map((result?.nodes || []).map((n) => [n.id, n]))
      if (!byId.size) { alert(`The model returned no details for "${title}". Try again.`); return }
      let touched = 0
      snapshot()
      patchSession(sid, (s) => ({
        ...s,
        nodes: s.nodes.map((n) => {
          const f = byId.get(n.id)
          if (!f) return n
          const pick = (next, cur) => {
            if (next == null || !String(next).trim()) return cur
            if (!overwrite && HAS(cur)) return cur // keep what the user wrote
            return String(next).trim()
          }
          const data = {
            ...n.data,
            description: pick(f.description, n.data?.description),
            input: pick(f.input, n.data?.input),
            output: pick(f.output, n.data?.output),
            duration: pick(f.duration, n.data?.duration),
            system: pick(f.system, n.data?.system),
          }
          // A detected system has to show: upgrade a plain Activity/Automated shape
          // to its System variant so the Sand band appears (§5b). Never downgrade —
          // if a step is already a system shape, leave its type alone.
          let type = n.type
          if (data.system && HAS(data.system)) {
            if (type === 'activity') type = 'activitySystem'
            else if (type === 'automatedActivity') type = 'automatedActivitySystem'
          }
          if (data.description !== n.data?.description || data.input !== n.data?.input ||
              data.output !== n.data?.output || data.duration !== n.data?.duration ||
              data.system !== n.data?.system || type !== n.type) touched += 1
          // The System variant is taller (it has the band), so keep style.height in
          // step with the type or the band renders clipped.
          const style = type !== n.type ? { ...n.style, height: SHAPE_MAP[type]?.size.height ?? n.style?.height } : n.style
          return { ...n, type, style, data }
        }),
      }))
      // The model can come back with fewer steps than it was given — on a long map
      // especially. Those rows then just stay blank with no explanation, which
      // reads exactly like "the button doesn't work". Name them instead.
      const missed = rows.filter((r) => !byId.has(r.id))
      const shown = missed.slice(0, 6).map((r) => r.data.numbering || r.data.label || r.id).join(', ')
      setTimeout(() => alert(
        `Updated details on ${touched} step${touched === 1 ? '' : 's'} in "${title}".` +
        (missed.length
          ? `\n\nThe model returned nothing for ${missed.length} step${missed.length === 1 ? '' : 's'}, ` +
            `so ${missed.length === 1 ? 'it was' : 'they were'} left as-is:\n${shown}` +
            `${missed.length > 6 ? ', …' : ''}\n\nRun it again to fill just those.`
          : ''),
      ), 50)
    } finally {
      endAI(sid)
    }
  }, [rows, activeId, active.title, currentSpec, patchSession, snapshot, beginAI, endAI])

  // Ask the AI to club the steps into 4-6 sequential brackets. Scoped to the
  // process it started from, like every other AI action here.
  const runGroupPhases = useCallback(async () => {
    if (!rows.length) { alert('Add some steps to the process first.'); return }
    const sid = activeId
    const title = active.title
    const spec = currentSpec()
    const signal = beginAI(sid, 'grouping')
    try {
      let res
      try {
        res = await groupIntoPhases({ spec, signal })
      } catch (e) {
        if (!e?.aborted) alert(`Could not group "${title}" into phases: ${e.message || e}`)
        return
      }
      const phases = (res?.phases || []).filter((p) => p?.id && p?.label)
      const assign = res?.assign || {}
      if (!phases.length) { alert(`No phases came back for "${title}". Try again.`); return }
      // Re-issue ids so a re-run can never collide with the previous grouping.
      const idMap = new Map(phases.map((p) => [p.id, newPhaseId()]))
      snapshot()
      patchSession(sid, (s) => ({
        ...s,
        phases: phases.map((p) => ({ id: idMap.get(p.id), label: p.label })),
        collapsedPhases: [],
        nodes: s.nodes.map((n) => {
          const pid = idMap.get(assign[n.id])
          return pid ? { ...n, data: { ...n.data, phase: pid } } : { ...n, data: { ...n.data, phase: undefined } }
        }),
      }))
      const missed = rows.filter((r) => !assign[r.id]).length
      setTimeout(() => alert(
        `Grouped "${title}" into ${phases.length} stages.` +
        (missed ? `\n\n${missed} step${missed === 1 ? '' : 's'} weren't assigned to any stage — ` +
          'they stay outside the brackets. Re-run, or drag them into place.' : ''),
      ), 50)
    } finally {
      endAI(sid)
    }
  }, [rows, activeId, active.title, currentSpec, patchSession, snapshot, beginAI, endAI])

  // Re-name the stages from what they now contain. Renaming only — the grouping
  // you did by hand is never touched.
  const runRenamePhases = useCallback(async () => {
    const list = phasesOf(active)
    if (!list.length) { alert('Group the process into stages first.'); return }
    const sid = activeId
    const title = active.title
    const laneName = (n) => active.laneLabels[laneIndexOf(n, rowsOf(active))] || ''
    const stages = list.map((p) => ({
      id: p.id,
      currentName: p.label,
      steps: active.nodes
        .filter((n) => n.data?.phase === p.id && n.type !== 'startEnd')
        .map((n) => ({ label: n.data?.label || '', owner: laneName(n), description: n.data?.description || '' })),
    })).filter((st) => st.steps.length)
    if (!stages.length) { alert('No stages have any steps yet.'); return }

    const signal = beginAI(sid, 'naming')
    try {
      let res
      try {
        res = await renamePhasesFromSteps({ stages, title, signal })
      } catch (e) {
        if (!e?.aborted) alert(`Could not rename the stages in "${title}": ${e.message || e}`)
        return
      }
      const names = res?.names || {}
      const hits = Object.keys(names).filter((k) => stages.some((st) => st.id === k)).length
      if (!hits) { alert(`No names came back for "${title}". Try again.`); return }
      snapshot()
      patchSession(sid, (s) => ({
        ...s,
        phases: phasesOf(s).map((p) => (names[p.id] ? { ...p, label: String(names[p.id]).trim() } : p)),
      }))
      setTimeout(() => alert(`Renamed ${hits} stage${hits === 1 ? '' : 's'} in "${title}".`), 50)
    } finally {
      endAI(sid)
    }
  }, [active, activeId, patchSession, snapshot, beginAI, endAI])

  // The command bar: an instruction rewrites the WHOLE map. Scoped to the process
  // it started from — an edit takes minutes and you may well have switched away.
  const [cmdError, setCmdError] = useState(null)
  const runCommand = useCallback(async (instruction) => {
    const sid = activeId
    const title = active.title
    const spec = currentSpec()
    setCmdError(null)
    const signal = beginAI(sid, 'command')
    try {
      const next = await editProcess({ instruction, spec, signal })
      onGeneratedRef.current(next, { sessionId: sid })
    } catch (e) {
      if (!e?.aborted) setCmdError(`Couldn't apply that to "${title}": ${e.message || e}`)
    } finally {
      endAI(sid)
    }
  }, [activeId, active.title, currentSpec, beginAI, endAI])

  // Gap analysis → concise bullets in a box under the board. Always asks the AI,
  // handing it the map exactly as it stands (lanes, every step, every edge), so
  // the insights describe THIS process rather than a canned write-up. If the call
  // fails we say so and leave the existing box alone — silently swapping in a
  // local approximation would look like a real answer when it isn't.
  // Scoped to its own process, like runFillDetails.
  const runAnalysis = useCallback(async () => {
    if (!rows.length) { alert('Add some steps to the process first.'); return }
    const sid = activeId
    const title = active.title
    const spec = currentSpec()
    const signal = beginAI(sid, 'analyzing')
    try {
      let gaps
      try {
        const result = await analyzeGaps({ spec, signal })
        gaps = result?.analysis || result?.gaps || null
      } catch (e) {
        if (!e?.aborted) alert(`Gap analysis failed for "${title}": ${e.message || e}`)
        return
      }
      if (!Array.isArray(gaps) || !gaps.length) {
        alert(`The model did not return any analysis for "${title}". Try again.`)
        return
      }
      snapshot()
      patchSession(sid, (s) => ({ ...s, analysis: gaps }))
      // Only re-fit if that process is still the one on screen.
      if (sid === stateRef.current.activeId) {
        setTimeout(() => fitView({ padding: 0.15, duration: 300, minZoom: 0.2 }), 80)
      }
    } finally {
      endAI(sid)
    }
  }, [rows, activeId, active.title, currentSpec, patchSession, snapshot, fitView, beginAI, endAI])

  // Expose the AI actions to the board nodes (the gap box's Regenerate) without a
  // temporal-dead-zone reference — boardCtx is built above where these are defined.
  aiActionsRef.current.runAnalysis = runAnalysis

  const clearAnalysis = useCallback(() => {
    snapshot()
    patchActive((s) => ({ ...s, analysis: null }))
  }, [patchActive, snapshot])

  const regenerateMap = useCallback(async () => {
    if (!rows.length) { alert('Add some rows to the table first.'); return }
    const sid = activeId
    const signal = beginAI(sid, 'regenerating')
    try {
      const spec = await mapFromTable({
        title: active.title,
        lanes: active.laneLabels,
        signal,
        rows: rows.map((r) => ({
          type: r.type,
          label: r.data.label || '',
          numbering: r.data.numbering || '',
          description: r.data.description || '',
          responsibility: r.responsibility,
          input: r.data.input || '',
          output: r.data.output || '',
          duration: r.data.duration || '',
        })),
      })
      onGenerated(spec, { sessionId: sid })
    } catch (e) {
      if (!e?.aborted) alert(e.message || String(e))
    } finally {
      endAI(sid)
    }
  }, [rows, activeId, active.title, active.laneLabels, onGenerated, beginAI, endAI])

  // Which SPACE we are in. The library never gets the studio's sidebar: it is not
  // an editor with the editing switched off, it is a different place.
  const space = view === 'library' || view === 'reader' ? 'library' : 'studio'
  const readerSession = sessions.find((x) => x.id === readerId)

  const spaceSwitch = (
    <div className="pd-spaces">
      <button
        className={space === 'studio' ? 'is-on' : ''}
        onClick={() => setView('home')}
        title="Studio — where processes are drafted, edited and published"
      >
        Studio
      </button>
      <button
        className={space === 'library' ? 'is-on' : ''}
        onClick={() => { setReaderId(null); setView('library') }}
        title="Library — the published processes everyone reads"
      >
        Library
        {sessions.filter((x) => statusOf(x) === PUBLISHED).length
          ? <span>{sessions.filter((x) => statusOf(x) === PUBLISHED).length}</span> : null}
      </button>
    </div>
  )

  // Nothing renders until we know where we are: the gallery at `/`, a password
  // screen for a locked link, or the workspace itself.
  if (boot === 'loading') {
    return <div className="pd-boot"><span className="pd-boot-mark">◆</span></div>
  }
  if (boot === 'gallery') {
    return <WorkspaceGallery onEnter={(ws) => enterWorkspace(ws, { push: true })} />
  }
  if (boot === 'locked' && lockedMeta) {
    return (
      <UnlockScreen
        meta={lockedMeta}
        onUnlocked={() => { const m = lockedMeta; setLockedMeta(null); enterWorkspace(m) }}
        onBack={() => { setLockedMeta(null); window.history.replaceState({}, '', '/'); setBoot('gallery') }}
      />
    )
  }

  const studioBar = (
    <StudioSwitcher
      workspaces={workspaces}
      currentId={studioId}
      currentName={wsName}
      onOpen={openWorkspace}
      onCreate={makeStudio}
      onRename={renameStudio}
      onSetPassword={changeWorkspacePassword}
      onDelete={removeWorkspace}
      onGallery={() => { window.location.href = '/' }}
      onSignOut={signOutWorkspace}
    />
  )

  return (
    <BoardContext.Provider value={boardCtx}>
      <div className={`pd-app is-${space}`}>
        {space === 'studio' && (
        <Sidebar
          view={view}
          onHome={() => setView('home')}
          onLibrary={() => setView('library')}
          publishedCount={sessions.filter((s) => statusOf(s) === PUBLISHED).length}
          sessions={sessions}
          activeId={activeId}
          onSelect={(id) => { setActiveId(id); if (view === 'home') setView('map') }}
          onNew={newProcess}
          onDelete={deleteProcess}
          onArchive={archiveProcess}
          onRestore={restoreProcess}
          archiveDays={ARCHIVE_DAYS}
          onPin={(id, pinned) => patchSession(id, (x) => ({ ...x, pinned }))}
          onSetGroup={(id, group) => patchSession(id, (x) => ({ ...x, group: group || undefined }))}
          onRename={(id) => {
            const s = sessions.find((x) => x.id === id)
            const name = prompt('Rename process', s?.title || '')
            if (name?.trim()) patchSession(id, (x) => ({ ...x, title: name.trim() }))
          }}
          onDuplicate={(id) => {
            const src = sessions.find((x) => x.id === id)
            if (!src) return
            snapshot()
            // A real copy: new ids throughout, so editing the duplicate can never
            // write back into the original.
            const copy = { ...JSON.parse(JSON.stringify(src)), id: uid('proc'), title: `${src.title} (copy)` }
            setSessions((ss) => [...ss, copy])
            setActiveId(copy.id)
          }}
          lanes={active.laneLabels}
          onRenameLane={renameLane}
          onReorderLane={reorderLane}
          onAddLane={addLane}
          onRemoveLane={removeLane}
          onRemoveLaneAt={removeLaneAt}
          autoConnect={autoConnect}
          onAutoConnect={setAutoConnect}
          info={info}
          setInfo={setInfo}
          studioBar={studioBar}
        />
        )}
        <div className="pd-canvas-wrap">
          <div className="pd-toolbar">
            {/* Row 1 — title + view & output actions. The studio switcher used to
                sit here; it now lives at the TOP of the sidebar (per request).
                In the Library (no sidebar) it stays here so it's still reachable. */}
            <div className="pd-toolbar-row">
              {space === 'library' && studioBar}
              {spaceSwitch}
              {space === 'library'
                ? <span className="pd-toolbar-home-label">
                    {view === 'reader' ? (readerSession?.publish?.snapshot?.title || 'Process') : 'Published processes'}
                  </span>
                : view === 'home'
                  ? <span className="pd-toolbar-home-label">Your processes</span>
                  : <>
                      <input className="pd-title-input" value={active.title} onChange={(e) => setTitle(e.target.value)} />
                      {/* The code is the process's identity, so clicking it is
                          where anyone would go to change it — or to see what this
                          process runs before and after. */}
                      <button
                        className="pd-code-chip"
                        onClick={() => setCardOpen(true)}
                        title="Process card — number, owner, cycle time and links to other processes"
                      >
                        {prefixOf(active) || 'Set a code'}
                      </button>
                    </>}
              {/* A store that stops storing must never be silent. */}
              <span
                className={`pd-dbstate is-${dbState}`}
                title={
                  dbState === 'offline'
                    ? 'NOT saved to the database — the local API is not responding. Your work is still in this browser; start the server (npm run dev) and it will be written on the next change.'
                    : 'Saved to the local SQLite database (data/process-designer.db), with a revision kept for each change.'
                }
              >
                {dbState === 'offline' ? '⚠ not saved to database'
                  : dbState === 'saving' ? '⋯ saving'
                  : dbState === 'loading' ? '⋯ loading'
                  : '● saved'}
              </span>
              {space === 'studio' && view !== 'home' && (
              <div className="pd-toolbar-actions">
                <button onClick={undo} title="Undo (⌘/Ctrl+Z)">↶</button>
                <button onClick={redo} title="Redo (⌘/Ctrl+Shift+Z)">↷</button>
                <div className="pd-viewtoggle">
                  <button className={view === 'phases' ? 'is-on' : ''} onClick={() => setView('phases')} title="The process as 4-6 stages — the high-level story">Phases</button>
                  <button className={view === 'map' ? 'is-on' : ''} onClick={() => setView('map')}>Map</button>
                  <button className={view === 'table' ? 'is-on' : ''} onClick={() => setView('table')}>Table</button>
                </div>
                {view === 'map' && (
                  <>
                    <button onClick={() => setPresenting(true)} title="Full-screen presenter: owner column stays fixed, scroll left/right through the process (Esc to exit)">▶ Present</button>
                    {/* Two very different artefacts: a picture of the flow, and
                        the written procedure the manual actually files. */}
                    <div className="pd-overflow">
                      <button
                        className="pd-export-btn"
                        onClick={() => setExportMenu((v) => !v)}
                        disabled={exporting}
                        title="Export this process"
                      >
                        {exporting ? 'Exporting…' : 'Export ▾'}
                      </button>
                      {exportMenu && (
                        <div className="pd-menu is-wide" onClick={() => setExportMenu(false)}>
                          <button onClick={exportImage}>
                            <strong>Process map image</strong>
                            <span>PNG of the whole swim-lane diagram</span>
                          </button>
                          <button onClick={() => {
                            setExporting(true)
                            downloadManual(active, { publish: active.publish, sessions })
                              .catch((e) => alert(`Could not build the Word document: ${e.message || e}`))
                              .finally(() => setExporting(false))
                          }}>
                            <strong>Procedure manual (Word)</strong>
                            <span>Editable .docx — process card, map and procedure table, in the People &amp; Culture manual format</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      className={`pd-publish-btn is-${publishState(active)}`}
                      onClick={() => openPublish(activeId)}
                      title={{
                        draft: 'Publish this process to the library everyone reads',
                        live: 'Published. Open to update the details or withdraw it.',
                        outdated: 'Published, but you have edited it since — readers are on the older version.',
                      }[publishState(active)]}
                    >
                      {{ draft: '↑ Publish', live: '● Published', outdated: '⚠ Publish edits' }[publishState(active)]}
                    </button>
                  </>
                )}
                {/* Destructive actions live behind an overflow, not one click from
                    Export where a slip wipes the board. */}
                <div className="pd-overflow">
                  <button className="pd-overflow-btn" onClick={() => setOverflow((v) => !v)} title="More">⋮</button>
                  {overflow && (
                    <div className="pd-menu" onClick={() => setOverflow(false)}>
                      <button className="pd-menu-danger" onClick={clearAll}>Clear all steps</button>
                    </div>
                  )}
                </div>
              </div>
              )}
            </div>
          </div>

          {refPickerFor && (
            <div className="pd-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setRefPickerFor(null) }}>
              <div className="pd-modal is-card" role="dialog" aria-modal="true">
                <h2>Which process does this refer to?</h2>
                <p className="pd-modal-lead">
                  The shape will show that process's code, and double-clicking it will
                  open it.
                </p>
                <div className="pd-card-linklist">
                  {sessions.filter((x) => x.id !== activeId).map((x) => (
                    <button
                      key={x.id}
                      className="pd-card-link"
                      onClick={() => linkProcessRef(refPickerFor, x.id)}
                    >
                      <span className="pd-card-link-code">{prefixOf(x) || '—'}</span>
                      <span className="pd-card-link-title">{x.title || 'Untitled process'}</span>
                    </button>
                  ))}
                  {sessions.length <= 1 && (
                    <div className="pd-card-hint">There are no other processes to refer to yet.</div>
                  )}
                </div>
                <div className="pd-modal-actions">
                  <button className="pd-modal-ghost" onClick={() => setRefPickerFor(null)}>Cancel</button>
                  {/* A link you cannot undo is a trap: pick the wrong process and
                      the only way back is deleting the shape. */}
                  {active.nodes.find((n) => n.id === refPickerFor)?.data?.refId && (
                    <button className="pd-modal-danger" onClick={() => linkProcessRef(refPickerFor, null)}>
                      Remove link
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {cardOpen && (
            <ProcessCard
              session={active}
              sessions={sessions}
              onClose={() => setCardOpen(false)}
              onSave={saveCard}
              onSuggestCode={(sess) => suggestProcessCode({ spec: specOf(sess), segments: SEGMENTS })}
            />
          )}

          {publishing && (() => {
            const ps = sessions.find((x) => x.id === publishing)
            return ps ? (
              <PublishDialog
                session={ps}
                sessions={sessions}
                onClose={() => setPublishing(null)}
                onPublish={(d) => commitPublish(ps.id, d)}
                onWithdraw={() => withdrawProcess(ps.id)}
                onWriteSummary={(sess) => summarizeProcess({ spec: specOf(sess) })}
              />
            ) : null
          })()}

          <div className="pd-canvas-body">
          <ViewBoundary resetKey={`${view}:${activeId}`} onReset={() => setView('home')}>
          {view === 'reader' && readerSession ? (
            <Reader session={readerSession} onBack={() => { setReaderId(null); setView('library') }} />
          ) : view === 'library' ? (
            <Portal
              sessions={sessions}
              onOpen={(id) => { setReaderId(id); setView('reader') }}
              onGoToStudio={() => setView('home')}
            />
          ) : view === 'home' ? (
            <Landing
              onGenerate={landingGenerate}
              onImportSpec={landingImport}
              onBlank={landingBlank}
              generating={busy.__landing__ === 'generating'}
              onStop={() => stopAI('__landing__')}
            />
          ) : view === 'phases' ? (
            <PhasesView
              session={active}
              laneOf={(n) => active.laneLabels[laneIndexOf(n, rowsOf(active))] || ''}
              onRename={renamePhase}
              onGroup={runGroupPhases}
              onAssign={assignSteps}
              onAddPhase={addPhase}
              onDeletePhase={deletePhase}
              onRecolor={recolorPhase}
              onRenameAll={runRenamePhases}
              onReorderPhase={reorderPhase}
              naming={busy[activeId] === 'naming'}
              busy={busy[activeId] === 'grouping'}
              onStop={() => stopAI(activeId)}
            />
          ) : view === 'map' ? (
            <>
              <CanvasTools
                selectMode={selectMode}
                onSelectMode={setSelectMode}
                selectedCount={selectedCount}
                onShiftCol={moveSelectedByColumn}
                onTidy={tidyLayout}
                onFit={() => fitView({ padding: 0.15, duration: 300, minZoom: 0.2 })}
                onAddCallout={addCallout}
              />
              <CommandBar
                onRun={runCommand}
                busyLabel={{
                  command: 'Updating the map',
                  filling: 'Filling in details',
                  analyzing: 'Analysing gaps',
                  grouping: 'Grouping into stages',
                }[busy[activeId]]}
                onStop={() => stopAI(activeId)}
                actions={[
                  { label: '✦ Fill details', run: runFillDetails,
                    hint: "Rewrite every step's description, input, output and duration from the map as it now stands" },
                  // Gap controls live in the dock (not on the box) — buttons inside
                  // a React Flow node don't take a click reliably. Before an
                  // analysis exists it's a single "Analyse" button; once it does,
                  // it becomes a "Gaps" menu grouping Regenerate / Hide / Edit.
                  active.analysis?.length
                    ? { label: '✦ Gaps', hint: 'Gap-analysis controls',
                        menu: [
                          { label: '✦ Regenerate', run: runAnalysis,
                            hint: 'Re-run the gap analysis against the map as it now stands' },
                          { label: active.analysisCollapsed ? '▸ Show gaps' : '▾ Hide gaps', run: toggleAnalysisCollapsed,
                            hint: 'Hide the whole gap-analysis box, or bring it back' },
                          { label: '✎ Edit', run: openGapEditor,
                            hint: 'Edit the gap-analysis text by hand' },
                        ] }
                    : { label: '✦ Analyse gaps', run: runAnalysis,
                        hint: 'Review the process against the seven angles and write concise, map-specific gaps' },
                  { label: '⧉ Group into phases', run: runGroupPhases,
                    hint: 'Club the steps into 4-6 sequential stages' },
                ]}
                error={cmdError}
                onDismissError={() => setCmdError(null)}
                disabled={!active.nodes.length}
              />
              {editingGaps && (
                <GapEditor
                  analysis={active.analysis || []}
                  onSave={(lines) => setAnalysis(lines)}
                  onClose={() => setEditingGaps(false)}
                />
              )}
              <ReactFlow
                nodes={renderedNodes}
                edges={renderedEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onReconnect={onReconnect}
                onNodeDragStart={onNodeDragStart}
                onNodeDragStop={onNodeDragStop}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onSelectionChange={onSelectionChange}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                defaultEdgeOptions={EDGE_OPTS}
                connectionLineType={ConnectionLineType.Step}
                snapToGrid
                snapGrid={[20, 20]}
                zoomOnDoubleClick={false}
                connectOnClick={false}
                connectionRadius={30}
                deleteKeyCode={['Backspace', 'Delete']}
                selectionOnDrag={selectMode}
                panOnDrag={!selectMode}
                selectionMode="partial"
                minZoom={0.2}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={20} size={1} color="#dfe4df" />
                <Controls />
                <MiniMap pannable zoomable nodeStrokeWidth={2} />
              </ReactFlow>
              {active.nodes.length === 0 && (
                <div className="pd-empty">
                  <div className="pd-empty-card">
                    <strong>Build your process</strong>
                    <p>① Rename the lanes on the left of the board for each owner / role</p>
                    <p>② Drag shapes onto a lane — they snap into place and auto-connect</p>
                    <p>③ Or use “Prompt to Process”, or the Table view, to build it</p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <TableView
              rows={rows}
              lanes={active.laneLabels}
              onUpdateNode={updateNodeData}
              onSetResponsibility={setNodeResponsibility}
              onAddRow={addRow}
              onDeleteRow={deleteRow}
            />
          )}
          </ViewBoundary>
          </div>
        </div>
      </div>

      {/* The studio presenter is the SAME component the library reader uses, so it
          gets the zoom controls too — a long process at fit-height is unreadable
          from across a room. */}
      {presenting && (
        <div className="pd-presenter">
          <div className="pd-presenter-bar">
            <span className="pd-presenter-title">{active.title}</span>
            <span className="pd-presenter-hint">Scroll ← → to walk through · owner column stays fixed · − / Fit / + to zoom</span>
            <button onClick={() => setPresenting(false)} title="Exit (Esc)">✕ Exit</button>
          </div>
          <div className="pd-presenter-stage">
            <PresenterView
              board={{
                title: active.title,
                laneLabels: active.laneLabels,
                laneRows: rowsOf(active),
                nodes: active.nodes,
                edges: active.edges,
              }}
              fullscreenable={false}
            />
          </div>
        </div>
      )}
    </BoardContext.Provider>
  )
}

// The number a process stamps on its steps. The card code wins once set; until
// then it is derived from the title, so a brand-new process is never uncoded.
function prefixOf(session) {
  return session?.card?.code ? codePrefix(session.card.code) : prefixFromTitle(session?.title || '')
}

// The wire format every AI call speaks. Module-level because it is asked for a
// session that is not necessarily the active one — the publish dialog summarises
// whichever process it was opened on.
function specOf(session) {
  const laneLabels = session.laneLabels || []
  return {
    title: session.title,
    lanes: laneLabels.map((label, i) => ({ id: `l${i}`, label })),
    nodes: (session.nodes || []).map((n) => ({
      id: n.id,
      type: n.type,
      lane: `l${laneIndexOf(n, rowsOf(session))}`,
      label: n.data?.label || '',
      numbering: n.data?.numbering || '',
      description: n.data?.description || '',
      input: n.data?.input || '',
      output: n.data?.output || '',
      duration: n.data?.duration || '',
      system: n.data?.system || '',
    })),
    edges: (session.edges || []).map((e) => ({ source: e.source, target: e.target, label: e.label || '' })),
    analysis: session.analysis || [],
  }
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  )
}
