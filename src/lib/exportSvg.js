// Render the whole swim-lane board to a standalone SVG string, straight from the
// board data — so an exported image looks exactly like the canvas (title bar,
// lane headers/bands, every shape with its real colours, orthogonal edges and
// the gap-analysis box). This avoids html-to-image's DOM-cloning quirks (missing
// structure, black SVG fills) and rasterises reliably because it uses only
// native SVG elements (no foreignObject).

import { SHAPE_MAP } from '../shapes'
import { TITLE_H, LANE_H, ROW_H, HEADER_W, COL_W, MIN_COLS } from '../board'
import { rowsOf, laneHeight, laneTop, boardHeight } from './lanes'
import { gapsToLines, classifyLine } from './analysisFormat'
import { codeFontSize } from './processCode'

// MBZUAI brand palette (Navy Blue + Sand) — mirrors src/index.css.
const C = {
  bg: '#f3f5f8',
  green: '#154677',   // Navy — title bar, lane headers, analysis border
  teal: '#154677',    // Navy — decision stroke + label
  tan: '#e5c687',     // Sand — Start/End, database
  tanDark: '#8a764d', // Dark Sand — borders on Sand
  red: '#b52529',     // brand Red — automation "A"
  ink: '#0c2945',     // Dark Navy — body text (and text on Sand, per AA rule)
  sand50: '#f2e3c3',  // Sand 50% — system band
  muted: '#5b6b7d',   // Navy-tinted muted
  line: '#24486f',    // Navy — edge connectors
  bandAlt: '#eaeef4', // faint Navy lane band
}
const FONT = "'Aktiv Grotesk', 'Aptos', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const MONO = "'Roboto Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace"

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const sizeOf = (n) => ({
  w: n.style?.width || SHAPE_MAP[n.type]?.size?.width || 160,
  h: n.style?.height || SHAPE_MAP[n.type]?.size?.height || 70,
})

// Greedy word wrap by an approximate character budget.
function wrap(text, maxChars) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean)
  const lines = []
  let cur = ''
  for (const w of words) {
    if (!cur) cur = w
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

// Multi-line centred text block.
function centeredText(cx, cy, lines, { size, weight = 400, fill, lineH, italic = false }) {
  const total = (lines.length - 1) * lineH
  let y = cy - total / 2
  const style = italic ? ' font-style="italic"' : ''
  return lines
    .map((ln) => {
      const t = `<text x="${cx}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}"${style} text-anchor="middle" dominant-baseline="central">${esc(ln)}</text>`
      y += lineH
      return t
    })
    .join('')
}

const HANDLE_PT = {
  t: (x, y, w, h) => ({ x: x + w / 2, y }),
  b: (x, y, w, h) => ({ x: x + w / 2, y: y + h }),
  l: (x, y, w, h) => ({ x, y: y + h / 2 }),
  r: (x, y, w, h) => ({ x: x + w, y: y + h / 2 }),
}
const NORMAL = { t: { dx: 0, dy: -1 }, b: { dx: 0, dy: 1 }, l: { dx: -1, dy: 0 }, r: { dx: 1, dy: 0 } }

// Orthogonal route that turns in the MIDDLE of the gap between the two shapes,
// not right against them. The People & Culture manual routes every branch and
// merge through the empty channel between columns — that's what gives its maps
// their air. Turning 16px off the box (what this used to do) crowds the corner
// against the shape and makes parallel edges converge into a bundle.
//
// It also matches React Flow's getSmoothStepPath on the canvas, which already
// centres its elbow; before this the exported image disagreed with the board.
function routePoints(s, sSide, t, tSide) {
  const sn = NORMAL[sSide] || NORMAL.r
  const tn = NORMAL[tSide] || NORMAL.l
  const sHoriz = sn.dx !== 0
  const tHoriz = tn.dx !== 0

  let raw
  if (sHoriz && tHoriz) {
    const midX = (s.x + t.x) / 2 // vertical run sits in the channel between columns
    raw = [s, { x: midX, y: s.y }, { x: midX, y: t.y }, t]
  } else if (!sHoriz && !tHoriz) {
    const midY = (s.y + t.y) / 2 // horizontal run sits between the two lanes
    raw = [s, { x: s.x, y: midY }, { x: t.x, y: midY }, t]
  } else if (sHoriz) {
    raw = [s, { x: t.x, y: s.y }, t] // out sideways, in from above/below
  } else {
    raw = [s, { x: s.x, y: t.y }, t] // out vertically, in from the side
  }
  // Drop consecutive duplicate points (straight runs collapse to a line).
  return raw.filter((p, i) => i === 0 || p.x !== raw[i - 1].x || p.y !== raw[i - 1].y)
}

function arrowHead(t, tSide) {
  const n = NORMAL[tSide] || NORMAL.l // outward normal; arrow points opposite (into node)
  const ix = -n.dx, iy = -n.dy // inward direction
  const L = 9, W = 5
  // base is behind the tip along the inward-reverse direction
  const bx = t.x - ix * L, by = t.y - iy * L
  // perpendicular
  const px = -iy, py = ix
  const p1 = `${bx + px * W},${by + py * W}`
  const p2 = `${bx - px * W},${by - py * W}`
  return `<polygon points="${t.x},${t.y} ${p1} ${p2}" fill="${C.line}" />`
}

function renderEdge(e, nodeById) {
  const sn = nodeById.get(e.source)
  const tn = nodeById.get(e.target)
  if (!sn || !tn) return ''
  const ss = sizeOf(sn), ts = sizeOf(tn)
  const sSide = (e.sourceHandle || 'r-s')[0]
  const tSide = (e.targetHandle || 'l-t')[0]
  const s = HANDLE_PT[sSide](sn.position.x, sn.position.y, ss.w, ss.h)
  const t = HANDLE_PT[tSide](tn.position.x, tn.position.y, ts.w, ts.h)
  // Same-lane bypass — mirrors ProcessEdge on the canvas, so the exported image
  // routes around the obstructing box exactly like the board does.
  const detourY = e.data?.detourY
  const pts =
    detourY != null
      ? (() => {
          const dir = t.x >= s.x ? 1 : -1
          const sx = s.x + dir * 34, tx = t.x - dir * 34
          return [s, { x: sx, y: s.y }, { x: sx, y: detourY }, { x: tx, y: detourY }, { x: tx, y: t.y }, t]
        })()
      : routePoints(s, sSide, t, tSide)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')
  let out = `<path d="${d}" fill="none" stroke="${C.line}" stroke-width="1.5" />` + arrowHead(t, tSide)
  if (e.label) {
    const mid = pts[Math.floor(pts.length / 2)]
    const lw = String(e.label).length * 7 + 12
    out +=
      `<rect x="${mid.x - lw / 2}" y="${mid.y - 10}" width="${lw}" height="20" rx="4" fill="#fff" stroke="#e2e6e2" />` +
      `<text x="${mid.x}" y="${mid.y}" font-family="${FONT}" font-size="11" font-weight="600" fill="${C.ink}" text-anchor="middle" dominant-baseline="central">${esc(e.label)}</text>`
  }
  return out
}

function renderNode(n) {
  const { w, h } = sizeOf(n)
  const x = n.position.x, y = n.position.y
  const cx = x + w / 2, cy = y + h / 2
  const d = n.data || {}
  const maxChars = Math.max(6, Math.floor((w - 22) / 6.6))

  if (n.type === 'startEnd') {
    return (
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${C.tan}" stroke="${C.tanDark}" stroke-width="1" />` +
      centeredText(cx, cy, wrap(d.label, maxChars), { size: 12.5, weight: 700, fill: C.ink, lineH: 15 })
    )
  }
  // Decisions and referenced processes are numbered steps too — show the code, or
  // the visible sequence gains phantom gaps where these shapes sit.
  const numberText = (ny, narrow = false) =>
    d.numbering
      ? `<text x="${cx}" y="${ny}" font-family="${MONO}" font-size="${codeFontSize(d.numbering, w, { narrow }).toFixed(2)}" fill="${C.muted}" text-anchor="middle" letter-spacing="0.2">${esc(d.numbering)}</text>`
      : ''
  if (n.type === 'decision') {
    const pts = `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`
    return (
      `<polygon points="${pts}" fill="#fff" stroke="${C.teal}" stroke-width="1.5" />` +
      numberText(y + 26, true) + // diamond: much narrower than its box here
      centeredText(cx, cy + (d.numbering ? 8 : 0), wrap(d.label, Math.floor(maxChars * 0.72)), { size: 11, weight: 600, fill: C.teal, lineH: 14 })
    )
  }
  if (n.type === 'callout') {
    // Sand bubble + tail, italic text — commentary, so it is never numbered. The
    // tail points whichever way the author turned it (data.tail).
    const dir = d.tail || 'br'
    const tx = dir.endsWith('l') ? x + 16 : x + w - 30
    const ty = dir.startsWith('t') ? y : y + h
    const dy = dir.startsWith('t') ? -13 : 13
    const tail = dir.endsWith('l')
      ? `M${tx + 14},${ty} L${tx},${ty} L${tx + 14},${ty + dy} Z`
      : `M${tx},${ty} L${tx + 14},${ty} L${tx},${ty + dy} Z`
    return (
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${C.tan}" stroke="${C.tanDark}" stroke-width="1" />` +
      `<path d="${tail}" fill="${C.tan}" />` +
      centeredText(cx, cy, wrap(d.label, Math.floor(maxChars * 1.1)), { size: 10.5, weight: 600, fill: '#3f3312', lineH: 14, italic: true })
    )
  }
  if (n.type === 'referencedProcess') {
    return (
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#fff" stroke="${C.ink}" stroke-width="1.5" />` +
      `<rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" fill="none" stroke="${C.red}" stroke-width="1.5" />` +
      numberText(y + 15) +
      centeredText(cx, cy + (d.numbering ? 6 : 0), wrap(d.label, maxChars), { size: 10.5, weight: 600, fill: C.red, lineH: 13 })
    )
  }
  if (n.type === 'database') {
    const ry = 10
    const path = `M${x},${y + ry} C${x},${y - 4} ${x + w},${y - 4} ${x + w},${y + ry} L${x + w},${y + h - ry} C${x + w},${y + h + 4} ${x},${y + h + 4} ${x},${y + h - ry} Z`
    const lid = `M${x},${y + ry} C${x},${y + ry + 14} ${x + w},${y + ry + 14} ${x + w},${y + ry}`
    return (
      `<path d="${path}" fill="${C.tan}" stroke="${C.tanDark}" stroke-width="1.5" />` +
      `<path d="${lid}" fill="none" stroke="${C.tanDark}" stroke-width="1.5" />` +
      centeredText(cx, cy + 6, wrap(d.label, maxChars), { size: 11.5, weight: 600, fill: C.ink, lineH: 14 })
    )
  }
  if (n.type === 'dataObject') {
    const fold = 18
    const path = `M${x},${y} L${x + w - fold},${y} L${x + w},${y + fold} L${x + w},${y + h} L${x},${y + h} Z`
    return (
      `<path d="${path}" fill="#fff" stroke="${C.teal}" stroke-width="1.5" />` +
      centeredText(cx, cy, wrap(d.label, maxChars), { size: 11.5, weight: 600, fill: C.ink, lineH: 14 })
    )
  }
  // activity + automatedActivity (+ system variants) — default rectangle
  const hasSystem = n.type === 'activitySystem' || n.type === 'automatedActivitySystem'
  const isAuto = n.type === 'automatedActivity' || n.type === 'automatedActivitySystem'
  const bandH = 22
  const lines = wrap(d.label, maxChars)
  let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#fff" stroke="${C.ink}" stroke-width="1.5" />`
  if (d.numbering) {
    out += `<text x="${cx}" y="${y + 14}" font-family="${MONO}" font-size="${codeFontSize(d.numbering, w).toFixed(2)}" fill="${C.muted}" text-anchor="middle" letter-spacing="0.2">${esc(d.numbering)}</text>`
  }
  // Centre the label in the area above the band (if any).
  const bodyBottom = hasSystem ? y + h - bandH : y + h
  const labelCy = (d.numbering ? (y + 20) : y) + ((bodyBottom - (d.numbering ? y + 20 : y)) / 2)
  out += centeredText(cx, labelCy, lines, { size: 12.5, weight: 600, fill: C.ink, lineH: 15 })
  if (isAuto) {
    out += `<text x="${x + w - 8}" y="${y + 14}" font-family="${FONT}" font-size="12" font-weight="700" fill="${C.red}" text-anchor="end">A</text>`
  }
  if (hasSystem) {
    const by = y + h - bandH
    out +=
      `<path d="M${x} ${by} H${x + w} V${y + h - 1} Q${x + w} ${y + h} ${x + w - 1} ${y + h} H${x + 1} Q${x} ${y + h} ${x} ${y + h - 1} Z" fill="${C.sand50}" />` +
      `<line x1="${x}" y1="${by}" x2="${x + w}" y2="${by}" stroke="${C.tanDark}" stroke-width="1.5" />` +
      `<text x="${cx}" y="${by + bandH / 2}" font-family="${MONO}" font-size="10" font-weight="600" fill="${C.ink}" text-anchor="middle" dominant-baseline="central">${esc(d.system || 'system?')}</text>`
  }
  return out
}

// Outline layout for the analysis box: numbered headings, indented sub-bullets,
// and "Summary: detail" bullets (bold before the colon), wrapped to the width.
function analysisSvg(analysis, boardW, topY) {
  const padX = 18, padTop = 14, lineH = 17, titleH = 30
  const items = gapsToLines(analysis).map((line) => {
    const c = classifyLine(line)
    if (c.kind === 'header') return { indent: 0, dash: false, gap: 8, tokens: [{ s: c.text, bold: true }] }
    if (c.kind === 'sub') return { indent: 22, dash: true, gap: 0, tokens: [{ s: c.text, bold: false }] }
    const tokens = []
    if (c.summary) tokens.push({ s: c.summary + ':', bold: true })
    String(c.rest || '').split(/\s+/).filter(Boolean).forEach((w) => tokens.push({ s: w, bold: false }))
    return { indent: 0, dash: true, gap: 0, tokens }
  })
  // Wrap each item's tokens to the available width.
  for (const it of items) {
    it.textX = padX + it.indent + (it.dash ? 14 : 0)
    const budget = Math.max(16, Math.floor((boardW - it.textX - padX) / 6.3))
    const rows = []
    let cur = [], len = 0
    for (const tk of it.tokens) {
      const add = (len ? 1 : 0) + tk.s.length
      if (len && len + add > budget) { rows.push(cur); cur = []; len = 0 }
      cur.push(tk); len += add
    }
    if (cur.length) rows.push(cur)
    it.rows = rows.length ? rows : [[]]
  }
  const totalRows = items.reduce((a, it) => a + it.rows.length, 0)
  const totalGap = items.reduce((a, it) => a + it.gap, 0)
  const boxH = padTop + titleH + totalRows * lineH + totalGap + padTop - lineH + 10
  let svg = `<rect x="0" y="${topY}" width="${boardW}" height="${boxH}" rx="4" fill="#fff" stroke="${C.green}" stroke-width="1.5" />`
  svg += `<rect x="0" y="${topY}" width="6" height="${boxH}" fill="${C.green}" />`
  svg += `<text x="${padX}" y="${topY + padTop + 8}" font-family="${FONT}" font-size="12" font-weight="700" letter-spacing="0.3" fill="${C.green}">GAP ANALYSIS · AREAS OF IMPROVEMENT</text>`
  let y = topY + padTop + titleH
  for (const it of items) {
    y += it.gap
    it.rows.forEach((row, ri) => {
      if (it.dash && ri === 0) {
        svg += `<text x="${padX + it.indent}" y="${y}" font-family="${FONT}" font-size="12" fill="${C.green}">–</text>`
      }
      const spans = row.map((tk, i) => `<tspan font-weight="${tk.bold ? 700 : 400}" fill="${tk.bold ? C.green : C.ink}">${esc((i ? ' ' : '') + tk.s)}</tspan>`).join('')
      svg += `<text x="${it.textX}" y="${y}" font-family="${FONT}" font-size="12">${spans}</text>`
      y += lineH
    })
  }
  return { svg, boxH }
}

export function boardToSvg({ title, laneLabels = [], laneRows, nodes = [], edges = [], analysis = null }, { pad = 40, background = null } = {}) {
  const stepNodes = nodes.filter((n) => n.position)
  const nodeById = new Map(stepNodes.map((n) => [n.id, n]))
  const laneCount = laneLabels.length || 1

  let maxRight = HEADER_W + MIN_COLS * COL_W
  for (const n of stepNodes) {
    const { w } = sizeOf(n)
    maxRight = Math.max(maxRight, n.position.x + w)
  }
  const boardW = Math.ceil(maxRight + COL_W * 0.15)
  const rows = rowsOf({ laneLabels, laneRows })
  const lanesBottom = laneTop(rows, laneCount)

  const parts = []
  // Lane bands + separators
  for (let i = 0; i < laneCount; i++) {
    const ty = laneTop(rows, i)
    const lh = laneHeight(rows, i)
    if (i % 2 === 1) parts.push(`<rect x="0" y="${ty}" width="${boardW}" height="${lh}" fill="${C.bandAlt}" />`)
    parts.push(`<line x1="0" y1="${ty + lh}" x2="${boardW}" y2="${ty + lh}" stroke="${C.teal}" stroke-width="1" opacity="0.5" />`)
  }
  // Title bar
  parts.push(`<rect x="0" y="0" width="${boardW}" height="${TITLE_H}" fill="${C.green}" />`)
  parts.push(`<text x="16" y="${TITLE_H / 2}" font-family="${FONT}" font-size="13" font-weight="700" fill="#fff" dominant-baseline="central">${esc(title || 'Untitled process')}</text>`)
  // Lane headers (green column) with owner names
  for (let i = 0; i < laneCount; i++) {
    const ty = laneTop(rows, i)
    const lh = laneHeight(rows, i)
    parts.push(`<rect x="0" y="${ty}" width="${HEADER_W}" height="${lh}" fill="${C.green}" />`)
    parts.push(centeredText(HEADER_W / 2, ty + lh / 2, wrap(laneLabels[i], 20), { size: 11, weight: 600, fill: '#e3ebf5', lineH: 14 }))
  }
  // Edges (under nodes)
  for (const e of edges) parts.push(renderEdge(e, nodeById))
  // Nodes
  for (const n of stepNodes) parts.push(renderNode(n))

  let totalH = lanesBottom
  if (analysis?.length) {
    const topY = lanesBottom + 28
    const { svg, boxH } = analysisSvg(analysis, boardW, topY)
    parts.push(svg)
    totalH = topY + boxH
  }

  const W = boardW + pad * 2
  const H = totalH + pad * 2
  // Omit the background rect when `background` is null → transparent PNG.
  const bgRect = background ? `<rect x="0" y="0" width="${W}" height="${H}" fill="${background}" />` : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    bgRect +
    `<g transform="translate(${pad}, ${pad})">${parts.join('')}</g>` +
    `</svg>`
  )
}

const boardWidthOf = (laneCount, stepNodes) => {
  let maxRight = HEADER_W + MIN_COLS * COL_W
  for (const n of stepNodes) maxRight = Math.max(maxRight, n.position.x + sizeOf(n).w)
  return Math.ceil(maxRight + COL_W * 0.15)
}

// ── Presenter view — split the board into a FIXED owner column and a scrollable
// body, both at natural scale so the presenter UI can size them to the viewport
// height (lanes stay aligned) and scroll the body left/right. ──────────────────

// Breathing room above and below the board in presenter view (board units).
const PRESENT_PAD_Y = 56

// The frozen left column: green title corner + green lane headers with owners.
export function presenterHeaderSvg({ laneLabels = [], laneRows, highlightOwner = '' }) {
  const laneCount = laneLabels.length || 1
  const rows = rowsOf({ laneLabels, laneRows })
  const Hc = laneTop(rows, laneCount)
  const H = Hc + PRESENT_PAD_Y * 2
  let p = `<rect x="0" y="0" width="${HEADER_W}" height="${TITLE_H}" fill="${C.green}" />`
  for (let i = 0; i < laneCount; i++) {
    const ty = laneTop(rows, i)
    const lh = laneHeight(rows, i)
    // With a chosen role, the reader's own lane stays bright and the rest fade.
    const dim = highlightOwner && laneLabels[i] !== highlightOwner
    p += `<rect x="0" y="${ty}" width="${HEADER_W}" height="${lh}" fill="${C.green}"${dim ? ' opacity="0.4"' : ''} />`
    p += centeredText(HEADER_W / 2, ty + lh / 2, wrap(laneLabels[i], 18), { size: 12.5, weight: dim ? 600 : 700, fill: dim ? '#8ba0bd' : '#fff', lineH: 15 })
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${HEADER_W}" height="${H}" viewBox="0 0 ${HEADER_W} ${H}"><rect width="${HEADER_W}" height="${H}" fill="${C.bg}"/><g transform="translate(0, ${PRESENT_PAD_Y})">${p}</g></svg>`
}

// The scrollable body: title bar, lane bands + separators, edges and nodes —
// everything to the RIGHT of the owner column (viewBox starts at HEADER_W).
export function presenterBodySvg({ title, laneLabels = [], laneRows, nodes = [], edges = [], highlightOwner = '' }) {
  const stepNodes = nodes.filter((n) => n.position)
  const nodeById = new Map(stepNodes.map((n) => [n.id, n]))
  const laneCount = laneLabels.length || 1
  const boardW = boardWidthOf(laneCount, stepNodes)
  const bodyW = boardW - HEADER_W + 40 // a little slack at the right end
  const rows = rowsOf({ laneLabels, laneRows })
  const Hc = laneTop(rows, laneCount)
  const H = Hc + PRESENT_PAD_Y * 2
  // "Who are you?" — which lane owner a node belongs to, so we can dim everyone
  // else's steps and leave the reader's own lit.
  const ownerOf = (n) => {
    const cy = n.position.y + (n.style?.height ?? 72) / 2
    let y = TITLE_H
    for (let i = 0; i < laneCount; i++) {
      const h = laneHeight(rows, i)
      if (cy < y + h || i === laneCount - 1) return laneLabels[i] || ''
      y += h
    }
    return ''
  }
  const dimmed = (n) => highlightOwner && ownerOf(n) !== highlightOwner
  let p = ''
  for (let i = 0; i < laneCount; i++) {
    const ty = laneTop(rows, i)
    const lh = laneHeight(rows, i)
    if (i % 2 === 1) p += `<rect x="${HEADER_W}" y="${ty}" width="${bodyW}" height="${lh}" fill="${C.bandAlt}" />`
    p += `<line x1="${HEADER_W}" y1="${ty + lh}" x2="${HEADER_W + bodyW}" y2="${ty + lh}" stroke="${C.teal}" stroke-width="1" opacity="0.5" />`
  }
  p += `<rect x="${HEADER_W}" y="0" width="${bodyW}" height="${TITLE_H}" fill="${C.green}" />`
  p += `<text x="${HEADER_W + 16}" y="${TITLE_H / 2}" font-family="${FONT}" font-size="14" font-weight="700" fill="#fff" dominant-baseline="central">${esc(title || 'Untitled process')}</text>`
  // With a role chosen, fade the flow lines back so the reader's own steps carry the
  // eye; edges are context, not the point.
  for (const e of edges) p += highlightOwner ? `<g opacity="0.3">${renderEdge(e, nodeById)}</g>` : renderEdge(e, nodeById)
  for (const n of stepNodes) p += dimmed(n) ? `<g opacity="0.22">${renderNode(n)}</g>` : renderNode(n)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${bodyW}" height="${H}" viewBox="${HEADER_W} 0 ${bodyW} ${H}">` +
    `<rect x="${HEADER_W}" y="0" width="${bodyW}" height="${H}" fill="${C.bg}"/>` +
    `<g transform="translate(0, ${PRESENT_PAD_Y})">${p}</g>` +
    `</svg>`
  )
}
