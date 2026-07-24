// A small picture of a process, for gallery cards.
//
// Not the real map. At 250px wide every label is illegible anyway, and rendering
// 250 full maps for one gallery would cost megabytes of SVG string. So this draws
// the SHAPE of the process — how many owners, how wide the flow, where it branches
// — as plain rectangles. That is exactly what you can read at thumbnail size, and
// it costs a couple of kilobytes.
//
// Fitted whole rather than cropped: the point of the picture is the SHAPE of the
// process, and a cropped corner shows the same handful of boxes for every card.
//
// It reads the published snapshot's geometry, so two processes look different here
// because they ARE different, not because of a random illustration.

const NAVY = '#154677'
const SAND = '#E5C687'
const LINE = '#c3cedb'

const isStartEnd = (n) => n.type === 'startEnd'
const isDecision = (n) => n.type === 'decision'

export function thumbnailSvg(board, { width = 480, height = 220 } = {}) {
  const nodes = board?.nodes || []
  const lanes = board?.laneLabels || []
  if (!nodes.length) return null

  const box = (n) => ({
    x: n.position?.x ?? 0,
    y: n.position?.y ?? 0,
    w: n.style?.width ?? 200,
    h: n.style?.height ?? 72,
  })

  const bs = nodes.map(box)
  const minX = Math.min(...bs.map((b) => b.x))
  const minY = Math.min(...bs.map((b) => b.y))
  const maxX = Math.max(...bs.map((b) => b.x + b.w))
  const maxY = Math.max(...bs.map((b) => b.y + b.h))
  const pad = 24
  const vw = Math.max(1, maxX - minX + pad * 2)
  const vh = Math.max(1, maxY - minY + pad * 2)

  const at = (n) => {
    const b = box(n)
    return { ...b, x: b.x - minX + pad, y: b.y - minY + pad }
  }
  const centre = (n) => { const b = at(n); return [b.x + b.w / 2, b.y + b.h / 2] }
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const parts = []

  // Lane stripes — the clearest signal of "how many people touch this".
  const rows = board?.laneRows || lanes.map(() => 1)
  let y = 40 - minY + pad
  lanes.forEach((_, i) => {
    const h = (rows[i] || 1) * 132
    if (i % 2 === 0) parts.push(`<rect x="0" y="${y}" width="${vw}" height="${h}" fill="${NAVY}" opacity="0.035"/>`)
    y += h
  })

  // Connectors first, so boxes sit on top.
  for (const e of board?.edges || []) {
    const a = byId.get(e.source)
    const b = byId.get(e.target)
    if (!a || !b) continue
    const [x1, y1] = centre(a)
    const [x2, y2] = centre(b)
    parts.push(`<path d="M${x1.toFixed(0)} ${y1.toFixed(0)} L${x2.toFixed(0)} ${y2.toFixed(0)}" stroke="${LINE}" stroke-width="3" fill="none"/>`)
  }

  for (const n of nodes) {
    const b = at(n)
    if (isDecision(n)) {
      const cx = b.x + b.w / 2
      const cy = b.y + b.h / 2
      const rx = Math.min(b.w, 110) / 2
      const ry = b.h / 2
      parts.push(`<path d="M${cx} ${(cy - ry).toFixed(0)} L${(cx + rx).toFixed(0)} ${cy.toFixed(0)} L${cx} ${(cy + ry).toFixed(0)} L${(cx - rx).toFixed(0)} ${cy.toFixed(0)} Z" fill="${SAND}"/>`)
    } else if (isStartEnd(n)) {
      parts.push(`<rect x="${b.x.toFixed(0)}" y="${b.y.toFixed(0)}" width="${b.w.toFixed(0)}" height="${b.h.toFixed(0)}" rx="${(b.h / 2).toFixed(0)}" fill="${NAVY}" opacity="0.55"/>`)
    } else {
      parts.push(`<rect x="${b.x.toFixed(0)}" y="${b.y.toFixed(0)}" width="${b.w.toFixed(0)}" height="${b.h.toFixed(0)}" rx="10" fill="${NAVY}"/>`)
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${vw.toFixed(0)} ${vh.toFixed(0)}" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`
}

export function thumbnailUrl(board, opts) {
  const svg = thumbnailSvg(board, opts)
  return svg ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) : null
}
