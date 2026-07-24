// Conceptual cover art for a process — the picture on a gallery card.
//
// The literal mini-map was the wrong picture: shrunk to a card it is a grey smudge
// of unreadable boxes, and every process's smudge looks like every other's. A card
// wants a COVER, not a diagram — something that reads at a glance, looks designed,
// and is recognisably THIS process rather than a stock illustration.
//
// So each process gets an abstract cover generated from its own content: a hue
// from its department, a flowing path whose bends come from the process's own
// branch/decision structure, and node beads along it. Same process → same cover,
// every time (no randomness); two processes look different because their shapes
// differ. All brand-family colours, so a wall of them looks like one product.


const MBZ_NAVY = '#154677'
const MBZ_SAND = '#E5C687'

// A stable hue per department so a whole department's cards share a family, and
// "Finance" is always the same colour wherever it appears.
// Departments are free text, so the hue is DERIVED from the name rather than
// looked up in a fixed table — every department gets a stable colour of its own,
// including ones invented later, and "Finance" is always the same colour.
const DEPT_HUE = { 'IFM - HR': 210 }

// djb2 → a stable number from any string, for the few decisions that aren't
// carried by the department or the shape counts.
function hash(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0
  return h >>> 0
}

const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`

export function coverArtSvg(session, { width = 480, height = 300 } = {}) {
  const snap = session?.publish?.snapshot || session || {}
  const title = snap.title || session?.title || 'Process'
  const dept = session?.publish?.department || 'Other'
  const nodes = snap.nodes || []

  const hue = DEPT_HUE[dept] ?? (hash(dept) % 360)
  const seed = hash(title)

  // The cover's structure comes from the process: how many owners (lanes), how
  // many steps, how many decision points. A branchier process gets a busier cover.
  const owners = (snap.laneLabels || []).length || 3
  const steps = nodes.filter((n) => n.type !== 'startEnd').length || 5
  const decisions = nodes.filter((n) => n.type === 'decision').length

  const W = 100, H = 62 // work in a compact viewBox, scale up with preserveAspectRatio

  // A flowing spine across the cover, its waviness driven by the branch count.
  const amp = 6 + Math.min(16, decisions * 4)
  const turns = 2 + (seed % 3) + Math.min(3, Math.floor(steps / 4))
  const midY = H * 0.55
  let d = `M -4 ${midY}`
  const beads = []
  const N = 40
  for (let i = 0; i <= N; i++) {
    const x = -4 + ((W + 8) * i) / N
    const y = midY + Math.sin((i / N) * Math.PI * turns + (seed % 10) / 3) * amp
      + Math.cos((i / N) * Math.PI * (turns + 1)) * (amp * 0.3)
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`
  }
  // Beads = the steps, spaced along the spine.
  const beadCount = Math.min(9, Math.max(3, steps))
  for (let i = 0; i < beadCount; i++) {
    const f = (i + 0.5) / beadCount
    const x = -4 + (W + 8) * f
    const y = midY + Math.sin(f * Math.PI * turns + (seed % 10) / 3) * amp
      + Math.cos(f * Math.PI * (turns + 1)) * (amp * 0.3)
    // One or two beads picked as "decisions" get the sand accent + diamond.
    const isAccent = decisions > 0 && (i % Math.max(2, Math.ceil(beadCount / (decisions || 1))) === 1)
    beads.push({ x, y, isAccent })
  }

  // Faint horizontal bands = the owners/lanes, so busier processes read as busier.
  const bands = []
  for (let i = 0; i < Math.min(6, owners); i++) {
    const y = (H * (i + 0.5)) / Math.min(6, owners)
    bands.push(`<rect x="0" y="${(y - 0.3).toFixed(1)}" width="${W}" height="0.6" fill="#fff" opacity="0.05"/>`)
  }

  const id = `g${seed % 100000}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${hsl(hue, 46, 26)}"/>
        <stop offset="1" stop-color="${hsl(hue, 52, 15)}"/>
      </linearGradient>
      <radialGradient id="${id}b" cx="0.8" cy="0.15" r="0.9">
        <stop offset="0" stop-color="${hsl(hue, 60, 42)}" stop-opacity="0.55"/>
        <stop offset="1" stop-color="${hsl(hue, 60, 42)}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#${id})"/>
    <rect width="${W}" height="${H}" fill="url(#${id}b)"/>
    ${bands.join('')}
    <path d="${d}" fill="none" stroke="#ffffff" stroke-opacity="0.28" stroke-width="0.8" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="${MBZ_SAND}" stroke-opacity="0.9" stroke-width="0.5" stroke-linecap="round" transform="translate(0 1.4)"/>
    ${beads.map((b) => b.isAccent
      ? `<rect x="${(b.x - 1.6).toFixed(1)}" y="${(b.y - 1.6).toFixed(1)}" width="3.2" height="3.2" rx="0.5" fill="${MBZ_SAND}" transform="rotate(45 ${b.x.toFixed(1)} ${b.y.toFixed(1)})"/>`
      : `<circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="1.7" fill="#fff"/><circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="1.7" fill="${MBZ_NAVY}" opacity="0.15"/>`
    ).join('')}
  </svg>`
}

export function coverArtUrl(session, opts) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(coverArtSvg(session, opts))
}
