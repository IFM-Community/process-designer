// Variable-height lanes.
//
// A lane used to be exactly one row tall, so a lane/column held exactly one
// shape and a second shape dropped there had nowhere to go. Now a lane is N rows
// tall: shapes stack vertically inside the same owner, and the lane band grows to
// fit them. Every other lane keeps its own height.
//
// The model:
//   ROW_H          the height of ONE row — the old LANE_H
//   laneRows[i]    how many rows lane i has (>= 1)
//   a shape sits at (lane, row, column) and is centred in that slot
//
// Node positions stay absolute pixels — that's what React Flow and the exporter
// consume — so whenever laneRows changes, every node below the change has to be
// re-seated. reseat() does that from a saved (lane,row) reading.

import { TITLE_H, ROW_H } from '../board'

export { ROW_H }

// Always return a clean array of positive integers, one per lane.
export function rowsOf(session) {
  const n = (session?.laneLabels || []).length
  const raw = Array.isArray(session?.laneRows) ? session.laneRows : []
  return Array.from({ length: n }, (_, i) => Math.max(1, Math.round(raw[i] || 1)))
}

export const laneHeight = (rows, i) => (rows[i] || 1) * ROW_H

export function laneTop(rows, i) {
  let y = TITLE_H
  for (let k = 0; k < i; k++) y += laneHeight(rows, k)
  return y
}

export const boardHeight = (rows) => laneTop(rows, rows.length)

// Centre of one slot — where a shape of that row sits.
export const slotCenterY = (rows, lane, row = 0) =>
  laneTop(rows, lane) + Math.min(row, (rows[lane] || 1) - 1) * ROW_H + ROW_H / 2

// Which (lane, row) a y-centre falls in. Clamped, so a shape dragged past the
// board's edge lands in the nearest real slot rather than nowhere.
export function slotAtY(rows, cy) {
  let y = TITLE_H
  for (let i = 0; i < rows.length; i++) {
    const h = laneHeight(rows, i)
    if (cy < y + h || i === rows.length - 1) {
      const row = Math.max(0, Math.min((rows[i] || 1) - 1, Math.floor((cy - y) / ROW_H)))
      return { lane: i, row }
    }
    y += h
  }
  return { lane: 0, row: 0 }
}

// Re-place every node after the lane heights change. `read` gives each node's
// (lane,row) under the OLD heights; the node is then centred in that same slot
// under the new ones.
export function reseat(nodes, oldRows, newRows, sizeOf) {
  return nodes.map((n) => {
    const size = sizeOf(n)
    if (!size) return n
    const cy = n.position.y + size.height / 2
    const { lane, row } = slotAtY(oldRows, cy)
    const want = slotCenterY(newRows, Math.min(lane, newRows.length - 1), row) - size.height / 2
    return Math.abs(n.position.y - want) < 0.5 ? n : { ...n, position: { ...n.position, y: want } }
  })
}

// How many rows each lane actually needs: the deepest stack in any one column.
// Used by Tidy to shrink lanes that no longer need the extra room.
export function requiredRows(nodes, laneCount, rows, sizeOf, colOf) {
  const counts = new Map() // `${lane}:${col}` -> n
  for (const n of nodes) {
    const size = sizeOf(n)
    if (!size) continue
    const { lane } = slotAtY(rows, n.position.y + size.height / 2)
    const key = `${lane}:${colOf(n)}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const need = Array.from({ length: laneCount }, () => 1)
  for (const [key, count] of counts) {
    const lane = Number(key.split(':')[0])
    if (lane < laneCount) need[lane] = Math.max(need[lane], count)
  }
  return need
}
