// Geometry + helpers for the swimlane process board.

export const TITLE_H = 40 // height of the green title bar
// Height of ONE row. Shapes must sit inside a row with real whitespace around
// them — the INFRA People & Culture manual (the house reference) keeps every
// shape well clear of its lane edges, so a Review/Endorse/Approve tower stacked
// across adjacent lanes reads as separate steps. We were at 104 with a 100-tall
// decision diamond: 2px of clearance, so stacked diamonds touched vertex-to-
// vertex and looked like one merged blob. Keep shapes at roughly half a row.
export const ROW_H = 132
// A lane is one or more rows tall (see src/lib/lanes.js). LANE_H is the height of
// a single-row lane — still the default, and what the geometry migration keys off.
export const LANE_H = ROW_H
export const HEADER_W = 152 // width of the lane's left label column
export const COL_W = 280 // horizontal spacing between activity columns (roomy)
export const MIN_COLS = 4 // board is at least this many columns wide (grows with content)

export const laneTop = (i) => TITLE_H + i * LANE_H
export const laneCenterY = (i) => laneTop(i) + LANE_H / 2
export const colCenterX = (col) => HEADER_W + col * COL_W + COL_W / 2

export function boardWidth(cols) {
  return HEADER_W + Math.max(cols, MIN_COLS) * COL_W
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Snap a node (top-left position + size) to the nearest lane row and column,
// returning the corrected top-left position plus the lane/column it landed in.
export function snapNode(pos, size, laneCount) {
  const cx = pos.x + size.width / 2
  const cy = pos.y + size.height / 2
  const lane = clamp(Math.floor((cy - TITLE_H) / LANE_H), 0, laneCount - 1)
  const col = Math.max(0, Math.round((cx - HEADER_W - COL_W / 2) / COL_W))
  const ncx = colCenterX(col)
  const ncy = laneCenterY(lane)
  return {
    x: ncx - size.width / 2,
    y: ncy - size.height / 2,
    lane,
    col,
    center: { x: ncx, y: ncy },
  }
}

// Choose orthogonal source/target handles from two node centres. Two steps in
// the SAME column connect vertically (an activity flowing straight up into its
// approval, stacked); anything in a DIFFERENT column exits sideways so a return
// arrow routes around a stack instead of straight down through it.
export function pickHandles(a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) < COL_W * 0.5) {
    return dy >= 0 ? ['b-s', 't-t'] : ['t-s', 'b-t']
  }
  return dx >= 0 ? ['r-s', 'l-t'] : ['l-s', 'r-t']
}
