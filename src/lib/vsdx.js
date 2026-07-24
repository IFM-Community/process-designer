// Read a Microsoft Visio .vsdx file into a process spec.
//
// .vsdx is an OPC package — a plain ZIP of XML parts. The useful ones are:
//   visio/pages/page1.xml   <Shapes> with <Text>, and <Connects> joining them
//
// This matters because Visio stores REAL connections, not just boxes that happen
// to sit near each other. So a .vsdx converts into a genuine flow (nodes AND
// edges), rather than being guessed at the way an image would have to be.
//
// No ZIP dependency: the browser's DecompressionStream('deflate-raw') does the
// inflating, and the central directory is ~60 lines of DataView reads.

// ---------------------------------------------------------------- ZIP reading
const u16 = (v, o) => v.getUint16(o, true)
const u32 = (v, o) => v.getUint32(o, true)

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip files')
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// Returns Map(path -> Uint8Array) for the entries we care about.
export async function readZip(buffer, wanted = () => true) {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // End of central directory: scan back for the signature (there may be a comment).
  let eocd = -1
  for (let i = view.byteLength - 22; i >= 0 && i > view.byteLength - 66000; i--) {
    if (u32(view, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Not a ZIP file (no end-of-central-directory record)')

  const count = u16(view, eocd + 10)
  let p = u32(view, eocd + 16) // start of central directory
  const out = new Map()

  for (let i = 0; i < count; i++) {
    if (u32(view, p) !== 0x02014b50) break
    const method = u16(view, p + 10)
    const compSize = u32(view, p + 20)
    const nameLen = u16(view, p + 28)
    const extraLen = u16(view, p + 30)
    const commentLen = u16(view, p + 32)
    const localOff = u32(view, p + 42)
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen

    if (!wanted(name)) continue

    // Local header: the name/extra lengths there can differ from the central ones.
    const lNameLen = u16(view, localOff + 26)
    const lExtraLen = u16(view, localOff + 28)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const raw = bytes.subarray(dataStart, dataStart + compSize)
    out.set(name, method === 0 ? raw : await inflateRaw(raw))
  }
  return out
}

// ---------------------------------------------------------------- Visio parts
const text = (b) => new TextDecoder().decode(b)

// Visio nests shapes (a container shape holds its label as a child), so collect
// text from a shape AND its descendants — otherwise most boxes come back blank.
function shapeText(el) {
  const parts = []
  for (const t of el.querySelectorAll('Text')) parts.push(t.textContent)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

const cellVal = (el, name) => {
  const c = [...el.children].find((x) => x.tagName === 'Cell' && x.getAttribute('N') === name)
  return c ? parseFloat(c.getAttribute('V')) : undefined
}

export function parseVisioPage(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Visio page XML could not be parsed')

  const shapes = new Map()
  for (const el of doc.querySelectorAll('Shapes > Shape')) {
    const id = el.getAttribute('ID')
    if (!id) continue
    const label = shapeText(el)
    shapes.set(id, {
      id,
      label,
      // PinX/PinY are the shape's centre in Visio's page units (inches, y-up).
      x: cellVal(el, 'PinX'),
      y: cellVal(el, 'PinY'),
      w: cellVal(el, 'Width'),
      h: cellVal(el, 'Height'),
      master: el.getAttribute('NameU') || el.getAttribute('Name') || '',
    })
  }

  // <Connect FromSheet="6" ToSheet="9" FromCell="EndX" ToCell="PinX"/>
  // A connector shape links to both ends, so we group by the connector's sheet id
  // and read off which shape is the "from" end and which is the "to".
  const byConnector = new Map()
  for (const c of doc.querySelectorAll('Connects > Connect')) {
    const conn = c.getAttribute('FromSheet')
    const other = c.getAttribute('ToSheet')
    const fromCell = c.getAttribute('FromCell') || ''
    if (!conn || !other) continue
    if (!byConnector.has(conn)) byConnector.set(conn, { begin: null, end: null })
    const slot = byConnector.get(conn)
    // BeginX = the tail of the arrow, EndX = the head.
    if (fromCell.startsWith('Begin')) slot.begin = other
    else if (fromCell.startsWith('End')) slot.end = other
    else if (!slot.begin) slot.begin = other
    else slot.end = other
  }

  const edges = []
  for (const [conn, { begin, end }] of byConnector) {
    if (!begin || !end || begin === end) continue
    edges.push({ source: begin, target: end, label: shapes.get(conn)?.label || '' })
  }

  // The connector shapes themselves are lines, not steps — drop them from nodes.
  const connectorIds = new Set(byConnector.keys())
  const nodes = [...shapes.values()].filter((s) => !connectorIds.has(s.id))

  return { nodes, edges }
}

// ---------------------------------------------------------------- to a spec
// Visio's y axis points UP and lanes are horizontal bands, so a shape's lane comes
// from its y position (inverted), and its position in the flow from x.
function inferLanes(nodes, laneShapes) {
  if (laneShapes.length) {
    const bands = laneShapes
      .map((l) => ({ label: l.label || 'Lane', y: l.y, h: l.h || 1 }))
      .sort((a, b) => b.y - a.y) // top of the page first
    return { labels: bands.map((b) => b.label), bands }
  }
  // No swim-lane shapes: cluster the y positions instead, so at least the rows
  // that visibly exist become lanes rather than everything collapsing into one.
  const ys = nodes.map((n) => n.y).filter((v) => Number.isFinite(v)).sort((a, b) => b - a)
  const bands = []
  for (const y of ys) {
    const near = bands.find((b) => Math.abs(b.y - y) < 0.6)
    if (near) near.y = (near.y + y) / 2
    else bands.push({ y, label: `Lane ${bands.length + 1}` })
  }
  return { labels: bands.map((b) => b.label), bands }
}

const laneIndexFor = (n, bands) => {
  if (!bands.length || !Number.isFinite(n.y)) return bands.length ? bands.length - 1 : 0
  let best = 0
  let bestD = Infinity
  bands.forEach((b, i) => {
    const d = Math.abs(b.y - n.y)
    if (d < bestD) { bestD = d; best = i }
  })
  return best
}

const looksLikeLane = (s) => /lane|swimlane|band|pool/i.test(s.master) || (s.w > 4 && s.h > 0.8)
const looksLikeDecision = (s) => /decision|diamond/i.test(s.master) || /\?$/.test(s.label.trim())
const looksLikeTerminator = (s) => /start|end|terminator|begin/i.test(`${s.master} ${s.label}`)

// Convert a parsed page into the app's spec shape (see lib/layout specToBoard).
export function visioToSpec(page, title) {
  const laneShapes = page.nodes.filter(looksLikeLane)
  const steps = page.nodes.filter((s) => !looksLikeLane(s) && s.label)
  const { labels, bands } = inferLanes(steps, laneShapes)

  const lanes = (labels.length ? labels : ['Process Team']).map((label, i) => ({ id: `l${i}`, label }))
  const idMap = new Map()
  let seq = 0 // counts NUMBERED steps only, so Start doesn't consume "01"
  const nodes = steps
    .slice()
    .sort((a, b) => (a.x ?? 0) - (b.x ?? 0)) // left to right = flow order
    .map((s) => {
      const nid = `v${s.id}`
      idMap.set(s.id, nid)
      const type = looksLikeTerminator(s) ? 'startEnd' : looksLikeDecision(s) ? 'decision' : 'activity'
      return {
        id: nid,
        type,
        lane: `l${Math.min(laneIndexFor(s, bands), lanes.length - 1)}`,
        label: s.label,
        numbering: type === 'startEnd' ? '' : String(++seq).padStart(2, '0'),
        description: '',
        input: '-',
        output: '-',
      }
    })

  const edges = page.edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({ source: idMap.get(e.source), target: idMap.get(e.target), label: e.label }))

  return { title, lanes, nodes, edges, analysis: [] }
}

// The whole trip: a .vsdx File -> a spec ready for specToBoard.
export async function importVsdx(file) {
  const buf = await file.arrayBuffer()
  const parts = await readZip(buf, (n) => /^visio\/pages\/page\d+\.xml$/i.test(n))
  if (!parts.size) {
    throw new Error(
      'No Visio pages found in that file. Visio 2013+ (.vsdx) is supported; ' +
      'the older binary .vsd format is not — re-save it as .vsdx from Visio.',
    )
  }
  // First page only: a multi-page Visio file is several processes, and silently
  // merging them would produce one meaningless map.
  const key = [...parts.keys()].sort()[0]
  const page = parseVisioPage(text(parts.get(key)))
  if (!page.nodes.length) throw new Error('That Visio page has no shapes with text on it.')
  return {
    spec: visioToSpec(page, file.name.replace(/\.vsdx$/i, '')),
    pages: parts.size,
    shapes: page.nodes.length,
    connections: page.edges.length,
  }
}
