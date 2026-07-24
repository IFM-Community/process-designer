// Rule-based (no API) gap analysis — same guiding principles as the AI
// version (as simple as possible, as automated as possible) computed locally
// from the board's own nodes, so it works without an Anthropic API key.

const REVIEW_WORDS = /approv|review|endorse|sign|check|verify|validate/i
const AUTOMATABLE_WORDS = /fill|template|generate|draft|collect|calculat|re-?key|data.?entry|copy|transcribe|\bprocess\b/i
const SKIP_TYPES = new Set(['startEnd', 'dataObject', 'database', 'laneBand', 'lane', 'processTitle'])

export function localAnalyzeGaps({ laneLabels = [], nodes = [], edges = [] }) {
  const steps = nodes.filter((n) => !SKIP_TYPES.has(n.type))
  const gaps = []
  if (!steps.length) return { gaps }

  const outgoing = new Map()
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, [])
    outgoing.get(e.source).push(e.target)
  }
  const byId = new Map(steps.map((n) => [n.id, n]))
  const isReview = (n) => n.type === 'decision' || REVIEW_WORDS.test(n.data?.label || '')

  // 1. Sequential review/approval chains.
  let longestChain = 0
  for (const n of steps) {
    if (!isReview(n)) continue
    let chain = 1
    let cur = n
    for (;;) {
      const nexts = (outgoing.get(cur.id) || []).map((id) => byId.get(id)).filter(Boolean)
      if (nexts.length !== 1 || !isReview(nexts[0])) break
      chain += 1
      cur = nexts[0]
    }
    longestChain = Math.max(longestChain, chain)
  }
  if (longestChain >= 2) {
    gaps.push({
      summary: 'Approvals run in series',
      explanation: `${longestChain} review/approval steps happen one after another; running them in parallel (or delegating) would cut wait time.`,
    })
  }

  // 2. Automation opportunity.
  const automatable = steps.filter((n) => n.type === 'activity' && AUTOMATABLE_WORDS.test(n.data?.label || ''))
  const automatedCount = steps.filter((n) => n.type === 'automatedActivity').length
  if (automatedCount === 0 && automatable.length > 0) {
    gaps.push({
      summary: 'Manual, automatable steps',
      explanation: `${automatable.length} step(s) look rule-based or repetitive (e.g. "${automatable[0].data?.label}") but run manually today — a good first automation target.`,
    })
  } else if (automatedCount === 0 && steps.length >= 5) {
    gaps.push({
      summary: 'Fully manual process',
      explanation: 'No step is system-driven yet — every hand-off relies on email or a document template with no system of record.',
    })
  }

  // 3. Missing SLAs / durations.
  const withDuration = steps.filter((n) => n.data?.duration && n.data.duration !== '-').length
  if (withDuration === 0 && steps.length >= 4) {
    gaps.push({
      summary: 'No SLA or tracking',
      explanation: 'No step has a time target, so delays only surface once someone chases them.',
    })
  }

  // 4. Hand-off density.
  if (laneLabels.length >= 5 && steps.length >= 8) {
    gaps.push({
      summary: 'Many hand-offs',
      explanation: `The process crosses ${laneLabels.length} owners; each hand-off is a place work can stall waiting on someone else.`,
    })
  }

  // 5. No shared system of record (most steps produce/consume nothing tracked).
  const noArtifact = steps.filter((n) => (!n.data?.input || n.data.input === '-') && (!n.data?.output || n.data.output === '-')).length
  if (steps.length >= 5 && noArtifact >= steps.length * 0.6) {
    gaps.push({
      summary: 'No shared system of record',
      explanation: 'Most steps produce no tracked artefact, so status and data likely get re-entered or re-confirmed at each hand-off.',
    })
  }

  // 6. Decisions with no visible rejection path.
  const deadEndDecisions = steps.filter((n) => n.type === 'decision' && (outgoing.get(n.id) || []).length < 2)
  if (deadEndDecisions.length > 0) {
    gaps.push({
      summary: 'No defined rejection path',
      explanation: `"${deadEndDecisions[0].data?.label}" and similar gates have only one way forward — an exception path just falls back to email.`,
    })
  }

  // 7. Owners are people, not roles — lane labels that look like personal names
  // rather than roles (no role keyword, and shaped like "First Last").
  const ROLE_WORDS = /team|office|department|dept|finance|hr|human resources|committee|supervisor|advisor|adviser|lead|manager|officer|unit|division|board|desk|group|admin|registrar|faculty|student|ceo|chro|provost|president|pmo|it|legal|procurement/i
  const looksLikePerson = (l) => !ROLE_WORDS.test(l) && /^[A-Z][a-z]+(\s+[—-]\s+.+|\s+[A-Z][a-z]+)/.test(l.trim())
  const personLanes = laneLabels.filter(looksLikePerson)
  if (personLanes.length >= 2) {
    gaps.push({
      summary: 'Owners are people, not roles',
      explanation: `Lanes like "${personLanes[0]}" name individuals rather than roles, so the process breaks when a person changes or is away.`,
    })
  }

  // 8. No close-out — nothing evaluates, hands over or onboards after the flow.
  const CLOSE_WORDS = /evaluat|onboard|feedback|close|hand.?over|review|report|survey|retro|debrief/i
  const hasCloseOut = steps.some((n) => CLOSE_WORDS.test(n.data?.label || ''))
  if (steps.length >= 4 && !hasCloseOut) {
    gaps.push({
      summary: 'No close-out',
      explanation: 'The flow ends at its last transactional step — no evaluation, hand-over or onboarding closes the loop.',
    })
  }

  return { gaps: gaps.slice(0, 7) }
}
