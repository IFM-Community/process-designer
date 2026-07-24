// Shared formatting for the gap-analysis box so the canvas display and the
// exported image render identically. The analysis is stored as free-form lines
// (strings); older data uses { summary, explanation } objects — both normalise
// to lines here.

export function gapsToLines(analysis) {
  return (analysis || [])
    .map((g) => (typeof g === 'string' ? g : g.explanation ? `${g.summary}: ${g.explanation}` : g.summary || ''))
    .filter((l) => l != null)
}

export const linesToText = (analysis) => gapsToLines(analysis).join('\n')
export const textToLines = (text) => text.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim())

// Classify a line for rendering:
//   header  — "1. Approvals"      → bold heading, no bullet
//   sub     — "- some question"   → indented bullet
//   bullet  — "Summary: detail"   → bullet, bold before the colon
export function classifyLine(line) {
  const t = line.trim()
  if (/^\d+[.)]\s+/.test(t)) return { kind: 'header', text: t }
  if (/^[-–•]\s+/.test(t)) return { kind: 'sub', text: t.replace(/^[-–•]\s+/, '') }
  // "Verdict — evidence" is the house shape (skill §10); "Verdict: evidence" is
  // accepted too. Whichever separator comes first wins, so an em-dash inside the
  // evidence can't be mistaken for the split.
  const dash = t.search(/\s[—–]\s/)
  const colon = t.indexOf(':')
  const useDash = dash > 0 && (colon < 0 || dash < colon)
  if (useDash && dash <= 48) {
    return { kind: 'bullet', summary: t.slice(0, dash), rest: t.slice(dash).replace(/^\s[—–]\s/, '') }
  }
  if (colon > 0 && colon <= 48) return { kind: 'bullet', summary: t.slice(0, colon), rest: t.slice(colon + 1).trim() }
  return { kind: 'bullet', summary: '', rest: t }
}
