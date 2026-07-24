// Process codes.
//
// A step's code carries where the process lives, not just its position in the
// flow: IFM-RCN-INT-AD-CRN-001 reads as
//
//   IFM   entity        which part of the organisation owns the process
//   RCN   process group recruitment
//   INT   process       intern hiring
//   AD    location      Abu Dhabi
//   CRN   variant       the current (as-is) version
//   001   step          sequential in flow order
//
// The point is that codes stay unique and comparable across a whole manual: the
// same step in the Paris variant is IFM-RCN-INT-PAR-CRN-001, and the redesign is
// IFM-RCN-INT-AD-TGT-001, so you can put them side by side and talk about "-007"
// without ambiguity.
//
// Segments are free text — these lists are suggestions, not a straitjacket.

export const SEGMENTS = [
  {
    key: 'entity', label: 'Entity', hint: 'Which part of the organisation',
    options: [['IFM', 'IFM'], ['MBZ', 'MBZUAI (central)'], ['CSI', 'Careers (CSI)']],
  },
  {
    key: 'group', label: 'Process group', hint: 'The family the process belongs to',
    options: [
      ['RCN', 'Recruitment'], ['ONB', 'Onboarding'], ['PER', 'Performance'],
      ['CMP', 'Compensation'], ['LRN', 'Learning & development'], ['EXT', 'Exit / off-boarding'],
      ['HCS', 'HC strategy & planning'], ['OPS', 'Operations'],
    ],
  },
  {
    key: 'process', label: 'Process', hint: 'The process itself',
    options: [
      ['INT', 'Intern'], ['FTE', 'Full-time hire'], ['CTR', 'Contractor'],
      ['PST', 'Job posting'], ['IVW', 'Interviewing'], ['OFR', 'Offer'],
    ],
  },
  {
    key: 'location', label: 'Location', hint: 'Where it runs',
    options: [['AD', 'Abu Dhabi'], ['PAR', 'Paris'], ['SVL', 'Silicon Valley'], ['GLB', 'Global / all sites']],
  },
  {
    key: 'variant', label: 'Variant', hint: 'Which version of the process',
    options: [['CRN', 'Current (as-is)'], ['PRP', 'Proposed'], ['TGT', 'Target design'], ['NEW', 'New']],
  },
]

export const EMPTY_CODE = { entity: '', group: '', process: '', location: '', variant: '' }
export const DEFAULT_WIDTH = 3 // 001, 002, …

const clean = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')

// The part before the step number, e.g. "IFM-RCN-INT-AD-CRN". Blank segments are
// skipped, so a half-filled code still produces something usable.
export function codePrefix(code) {
  if (!code) return ''
  return SEGMENTS.map((s) => clean(code[s.key])).filter(Boolean).join('-')
}

export const formatCode = (code, n, width = DEFAULT_WIDTH) => {
  const p = codePrefix(code)
  const num = String(n).padStart(width, '0')
  return p ? `${p}-${num}` : num
}

// A worked example for the UI, so the shape of the scheme is visible while typing.
export const sampleCode = (code, width = DEFAULT_WIDTH) => formatCode(code, 1, width)

// Font size that keeps a code inside its shape.
//
// Codes got long when they gained the full scheme (IFM-RCN-INT-PAR-CRN-009 is 23
// characters), and at a fixed 8.5px they ran straight out through the sides of a
// decision diamond. Text must stay inside the shape, so shrink it to fit rather
// than clip it.
//
// `narrow` is for the diamond: it offers only a fraction of its box width at the
// line the code sits on, and that line MOVES — a two-line label pushes the code
// further towards the tip, where there is less room still. Measured on a real
// board, 0.62 of the width left two of 23 codes poking out; 0.50 covers the
// worst case, so the factor is deliberately pessimistic rather than average.
const MONO_RATIO = 0.60 // width of one monospace glyph ÷ font size
export function codeFontSize(text, boxWidth, { narrow = false, max = 8.5, min = 5.6 } = {}) {
  const len = String(text || '').length
  if (!len) return max
  const avail = (narrow ? boxWidth * 0.50 : boxWidth - 16)
  return Math.max(min, Math.min(max, avail / (len * MONO_RATIO)))
}

// ---------------------------------------------------------------------------
// The code is DERIVED FROM THE TITLE. Nobody should have to fill in five boxes
// that only restate what the title already says: "Intern Process (Current - Abu
// Dhabi)" already contains the process, the variant and the site.
//
// Matching is on whole words, longest phrase first, so "Abu Dhabi" wins over a
// stray "AD" and "full-time" isn't read as "time".
const MATCH = {
  process: [
    [/\bintern(ship)?s?\b/i, 'INT'], [/\bfull[- ]?time\b|\bfte\b/i, 'FTE'],
    [/\bcontractor\b/i, 'CTR'], [/\bjob post|posting\b/i, 'PST'],
    [/\binterview/i, 'IVW'], [/\boffer\b/i, 'OFR'],
  ],
  location: [
    [/\babu dhabi\b|\bauh\b/i, 'AD'], [/\bparis\b/i, 'PAR'],
    [/\bsilicon valley\b|\bsvl\b/i, 'SVL'], [/\bglobal\b/i, 'GLB'],
  ],
  variant: [
    [/\btarget\b/i, 'TGT'], [/\bpropos/i, 'PRP'],
    [/\bcurrent\b|\bas[- ]is\b/i, 'CRN'], [/\bnew\b/i, 'NEW'],
  ],
  group: [
    [/\bonboard/i, 'ONB'], [/\bperformance\b/i, 'PER'], [/\bcompensation\b|\bpay\b/i, 'CMP'],
    [/\blearning\b|\btraining\b/i, 'LRN'], [/\bexit\b|\boff[- ]?board/i, 'EXT'],
    [/\bstrategy\b|\bplanning\b/i, 'HCS'],
  ],
}

// Which group a process belongs to when the title doesn't name one outright.
const GROUP_OF = { INT: 'RCN', FTE: 'RCN', CTR: 'RCN', PST: 'RCN', IVW: 'RCN', OFR: 'RCN' }

const firstMatch = (title, rules) => (rules.find(([re]) => re.test(title)) || [])[1] || ''

export function codeFromTitle(title, entity = 'IFM') {
  const t = String(title || '')
  const process = firstMatch(t, MATCH.process)
  const group = firstMatch(t, MATCH.group) || GROUP_OF[process] || ''
  return {
    entity: t ? entity : '',
    group,
    process,
    location: firstMatch(t, MATCH.location),
    variant: firstMatch(t, MATCH.variant),
  }
}

export const prefixFromTitle = (title, entity) => codePrefix(codeFromTitle(title, entity))

// Read a code back into segments — used to seed the editor from a process that
// already has numbering, so existing work isn't retyped.
export function parseCode(str) {
  const parts = String(str || '').trim().split('-').filter(Boolean)
  if (parts.length < 2) return null
  if (/^\d+$/.test(parts[parts.length - 1])) parts.pop() // drop the step number
  const code = { ...EMPTY_CODE }
  const keys = SEGMENTS.map((s) => s.key)
  // Right-align: a short code like INT-AD-CRN fills the LAST segments, because
  // the trailing ones (location, variant) are the ones people always write.
  const offset = Math.max(0, keys.length - parts.length)
  parts.forEach((p, i) => { if (offset + i < keys.length) code[keys[offset + i]] = clean(p) })
  return code
}
