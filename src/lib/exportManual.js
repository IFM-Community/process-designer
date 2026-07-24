import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ImageRun, PageOrientation,
} from 'docx'
import { boardToSvg } from './exportSvg'
import { flowOrder } from './layout'
import { codePrefix, prefixFromTitle } from './processCode'

// Export as a PROCEDURE MANUAL — a real Word (.docx) document, in the house format.
//
// This writes a process up the way the INFRA People & Culture manual writes its
// processes up, so the output can drop straight into that manual:
//
//   x.1  Process Card       name, number, owner, description, input/output,
//                           responsible function, cycle time, process links
//   x.2  Process Map        the diagram (rasterised and embedded as an image)
//   x.3  Process Procedure  # | Activity | Description | Responsibility |
//                           Input | Output | Duration
//
// It is a genuine .docx built with the `docx` library, not HTML with a .doc
// extension — it opens in Word, Pages and Google Docs as an editable document, and
// the tables are real Word tables an author can keep editing.

const NAVY = '154677'
const NAVY_TINT = 'EEF3F8'
const SUBTLE = 'F7FAFC'
const BORDER = 'C9D4E0'

// The manual writes activity descriptions as bullets. Ours are prose, so split on
// the boundaries authors actually type rather than inventing structure.
const bullets = (text) => {
  const t = String(text || '').trim()
  if (!t) return []
  const lines = t.split(/\n+|(?:^|\s)[•\-–]\s+/).map((x) => x.trim()).filter(Boolean)
  if (lines.length > 1) return lines
  return t.split(/(?<=[.;])\s+(?=[A-Z])/).map((x) => x.trim()).filter(Boolean)
}

const laneIndex = (n, laneRows) => {
  const h = n.style?.height ?? 72
  const mid = n.position.y + h / 2 - 40
  let top = 0
  for (let i = 0; i < laneRows.length; i++) {
    const hh = laneRows[i] * 132
    if (mid < top + hh) return i
    top += hh
  }
  return Math.max(0, laneRows.length - 1)
}

// Everything the document needs, pulled from the session once.
function manualData(session, { publish, sessions = [] } = {}) {
  const card = session.card || {}
  const number = card.code ? codePrefix(card.code) : prefixFromTitle(session.title || '')
  const linkNames = (ids) => (ids || [])
    .map((id) => sessions.find((s) => s.id === id))
    .filter(Boolean)
    .map((s) => `${s.card?.code ? codePrefix(s.card.code) : prefixFromTitle(s.title)}  ${s.title}`)

  const { title = 'Process', laneLabels = [], nodes = [], edges = [] } = session
  const laneRows = session.laneRows?.length ? session.laneRows : laneLabels.map(() => 1)
  const ownerOf = (n) => laneLabels[laneIndex(n, laneRows)] || '—'

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const steps = flowOrder(nodes, edges).order
    .map((id) => byId.get(id))
    .filter((n) => n && n.type !== 'startEnd' && n.type !== 'callout')

  const counts = new Map()
  for (const n of steps) counts.set(ownerOf(n), (counts.get(ownerOf(n)) || 0) + 1)
  const owner = card.owner || [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—'

  const real = (v) => v && !/^[-–—\s]*$/.test(v)
  const ins = [...new Set(steps.slice(0, 2).map((n) => n.data?.input).filter(real))]
  const outs = [...new Set(steps.slice(-2).map((n) => n.data?.output).filter(real))]

  return {
    title, number, owner, laneLabels, laneRows, nodes, edges, steps, ownerOf, ins, outs,
    department: publish?.department || 'IFM',
    summary: publish?.summary || '',
    cycleTime: card.cycleTime || 'TBD',
    preceding: linkNames(card.links?.preceding),
    subsequent: linkNames(card.links?.subsequent),
  }
}

// Rasterise the map SVG to a PNG the document can embed. Word doesn't render SVG
// reliably, so we hand it a bitmap — the same rasterisation the PNG export uses.
async function rasterise(svg) {
  const m = svg.match(/width="(\d+)" height="(\d+)"/)
  const w = m ? +m[1] : 1200
  const h = m ? +m[2] : 800
  const scale = 2
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  const img = new Image()
  const blob = await new Promise((resolve, reject) => {
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = w * scale
      c.height = h * scale
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('rasterise failed'))), 'image/png')
    }
    img.onerror = () => reject(new Error('the map could not be rasterised'))
    img.src = url
  })
  return { data: new Uint8Array(await blob.arrayBuffer()), w, h }
}

// ---- docx building blocks ----
const cellBorders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  left: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  right: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
}

const text = (s, opts = {}) => new TextRun({ text: String(s ?? ''), ...opts })

const para = (children, opts = {}) =>
  new Paragraph({ children: Array.isArray(children) ? children : [children], spacing: { after: 40 }, ...opts })

const bulletsOrDash = (items) =>
  items.length
    ? items.map((t) => new Paragraph({ children: [text(t)], bullet: { level: 0 }, spacing: { after: 20 } }))
    : [para(text('-', { color: '9AA7B5' }))]

const cell = (children, { span, fill, width, header } = {}) =>
  new TableCell({
    children: Array.isArray(children) ? children : [children],
    columnSpan: span,
    shading: fill ? { fill } : undefined,
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    borders: cellBorders,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    verticalAlign: header ? undefined : 'top',
  })

const labelCell = (t, opts = {}) =>
  cell(para(text(t, { bold: true, color: NAVY })), { fill: NAVY_TINT, ...opts })

const subHead = (t, opts = {}) =>
  cell(para(text(t, { bold: true, color: NAVY }), { alignment: AlignmentType.CENTER }), { fill: SUBTLE, ...opts })

function processCardTable(d) {
  const row = (cells) => new TableRow({ children: cells })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [18, 32, 18, 32],
    rows: [
      row([labelCell('Name', { width: 18 }), cell(para(text(d.title)), { width: 32 }),
        labelCell('Number', { width: 18 }), cell(para(text(d.number)), { width: 32 })]),
      row([labelCell('Process Owner'), cell(para(text(d.owner))),
        labelCell('Last Update'), cell(para(text(new Date().toLocaleDateString('en-GB'))))]),
      row([labelCell('Description'), cell(para(text(d.summary)), { span: 3 })]),
      row([subHead('Input', { span: 2 }), subHead('Output', { span: 2 })]),
      row([cell(bulletsOrDash(d.ins), { span: 2 }), cell(bulletsOrDash(d.outs), { span: 2 })]),
      row([labelCell('Responsible Function'), cell(para(text(d.department)), { span: 3 })]),
      row([labelCell('Responsible Sub-Function'), cell(bulletsOrDash(d.laneLabels.filter(Boolean)), { span: 3 })]),
      row([labelCell('Process Cycle time'), cell(para(text(d.cycleTime)), { span: 3 })]),
      row([subHead('Preceding'), subHead('Intermediate'), subHead('Subsequent', { span: 2 })]),
      row([cell(bulletsOrDash(d.preceding)), cell([para(text('-', { color: '9AA7B5' }))]),
        cell(bulletsOrDash(d.subsequent), { span: 2 })]),
    ],
  })
}

function procedureTable(d) {
  const th = (t, width) =>
    new TableCell({
      children: [para(text(t, { bold: true, color: 'FFFFFF' }))],
      shading: { fill: NAVY }, borders: cellBorders, width: { size: width, type: WidthType.PERCENTAGE },
      margins: { top: 60, bottom: 60, left: 90, right: 90 },
    })
  const header = new TableRow({
    tableHeader: true,
    children: [th('#', 9), th('Activity', 15), th('Description', 33), th('Responsibility', 13),
      th('Input', 11), th('Output', 11), th('Duration', 8)],
  })
  const dash = () => para(text('-', { color: '9AA7B5' }))
  const rows = d.steps.map((n, i) => new TableRow({
    children: [
      cell([para(text(n.data?.numbering || '', { font: 'Consolas', size: 16, color: NAVY }))],
        { fill: i % 2 ? SUBTLE : undefined }),
      cell([para(text(n.data?.label || '', { bold: true }))], { fill: i % 2 ? SUBTLE : undefined }),
      cell(bulletsOrDash(bullets(n.data?.description)), { fill: i % 2 ? SUBTLE : undefined }),
      cell([para(text(d.ownerOf(n)))], { fill: i % 2 ? SUBTLE : undefined }),
      cell([n.data?.input ? para(text(n.data.input)) : dash()], { fill: i % 2 ? SUBTLE : undefined }),
      cell([n.data?.output ? para(text(n.data.output)) : dash()], { fill: i % 2 ? SUBTLE : undefined }),
      cell([n.data?.duration ? para(text(n.data.duration)) : dash()], { fill: i % 2 ? SUBTLE : undefined }),
    ],
  }))
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows] })
}

async function buildManualDoc(session, opts) {
  const d = manualData(session, opts)
  const svg = boardToSvg(
    { title: d.title, laneLabels: d.laneLabels, laneRows: d.laneRows, nodes: d.nodes, edges: d.edges },
    { background: '#ffffff' },
  )
  const png = await rasterise(svg)
  // Fit the map to the landscape text width (~9.6in ≈ 920px at 96dpi).
  const maxW = 920
  const imgW = Math.min(png.w, maxW)
  const imgH = Math.round((png.h * imgW) / png.w)

  const heading = (t, level) => new Paragraph({ text: t, heading: level, spacing: { before: 240, after: 120 } })

  return new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children: [
        new Paragraph({
          children: [text(`${d.department}  |  Procedure Manual`, { color: NAVY, bold: true, size: 18 }),
            text(`          ${d.number}`, { color: NAVY, size: 18 })],
          border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 6 } },
          spacing: { after: 200 },
        }),
        new Paragraph({ children: [text(d.title, { bold: true, color: NAVY, size: 34 })], spacing: { after: 160 } }),

        heading('1. Process Card', HeadingLevel.HEADING_2),
        processCardTable(d),

        heading('2. Process Map', HeadingLevel.HEADING_2),
        // `type` is required in docx v9+ — without it the media part is written as
        // ".undefined" and Word silently drops the map.
        new Paragraph({ children: [new ImageRun({ type: 'png', data: png.data, transformation: { width: imgW, height: imgH } })] }),

        heading('3. Process Procedure', HeadingLevel.HEADING_2),
        procedureTable(d),

        new Paragraph({
          children: [text(`Generated from Process Designer on ${new Date().toLocaleString('en-GB')}. Layout follows the INFRA People & Culture Procedure Manual.`, { size: 16, color: '7D8B9A', italics: true })],
          spacing: { before: 240 },
        }),
      ],
    }],
  })
}

// Build and download the .docx.
export async function downloadManual(session, opts) {
  const doc = await buildManualDoc(session, opts)
  const blob = await Packer.toBlob(doc)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${(session.title || 'process').replace(/[^\w\s-]/g, '').trim() || 'process'} — procedure.docx`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
