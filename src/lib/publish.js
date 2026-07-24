// Publishing — the line between the drafting tool and the repository.
//
// The product now has two audiences with opposite needs:
//
//   BACKEND (authors)   — messy, iterative, everything editable. Drafts live here.
//   FRONTEND (everyone) — "how do I hire an intern?" They need ONE answer they can
//                         trust, not five half-finished variants of it.
//
// A published process is therefore a SNAPSHOT, not a live pointer. If the frontend
// read the draft directly, every half-finished edit an author made would be live to
// the whole university the moment they typed it. Publishing copies the process as
// it stands; the author carries on editing the draft, and nothing changes for
// readers until someone publishes again.

export const DRAFT = 'draft'
export const IN_REVIEW = 'in_review'
export const PUBLISHED = 'published'

export const STATUS_LABEL = {
  [DRAFT]: 'Draft',
  [IN_REVIEW]: 'In review',
  [PUBLISHED]: 'Published',
}

// The catalogue the frontend browses by. Deliberately a short, closed-ish list:
// a gallery with forty one-process categories is not a gallery.
// The starting catalogue. Deliberately just the one the team actually files
// under — a dropdown of eight invented departments made every publish a guess.
// It is not a fixed list: the publish dialog lets you type a new one, and any
// department already in use joins the list automatically (see allDepartments).
export const DEPARTMENTS = [
  'IFM - HR',
]

// A fingerprint of the content that was published.
//
// Without it, "Published" is a badge that never goes stale: you publish, edit ten
// more times, and readers keep getting version 1 while the studio still says the
// process is live. Comparing fingerprints tells an author their published copy has
// fallen behind, which is the only honest thing to show them.
export function fingerprintOf(session) {
  const body = JSON.stringify({
    lanes: session?.laneLabels || [],
    nodes: (session?.nodes || []).map((n) => [n.id, n.type, n.data?.label, n.data?.numbering,
      n.data?.description, n.data?.input, n.data?.output, Math.round(n.position?.y ?? 0)]),
    edges: (session?.edges || []).map((e) => [e.source, e.target, e.label || '']),
  })
  // djb2 — enough to notice an edit; this is a staleness check, not security.
  let h = 5381
  for (let i = 0; i < body.length; i++) h = ((h << 5) + h + body.charCodeAt(i)) | 0
  return String(h >>> 0)
}

// 'draft'    — never published
// 'live'     — published, and the draft still matches what readers see
// 'outdated' — published, but edited since; readers are on an older version
export function publishState(session) {
  if (statusOf(session) !== PUBLISHED) return 'draft'
  // Anything published before fingerprints existed has nothing to compare against.
  // Calling it outdated would accuse the author of an edit they never made, so it
  // is grandfathered in as live until the next publish records a fingerprint.
  if (!session.publish?.fingerprint) return 'live'
  return session.publish.fingerprint === fingerprintOf(session) ? 'live' : 'outdated'
}

// Departments are a starting list, not a fixed one — a university grows teams
// faster than anyone updates a constant. Whatever has been used is offered too.
export function allDepartments(sessions = []) {
  const used = sessions.map((s) => s.publish?.department).filter(Boolean)
  return [...new Set([...DEPARTMENTS, ...used])]
}

// A serviceable one-liner without waiting on a model, so the publish dialog is
// never blocked. The AI rewrite lands on top of this when it arrives.
export function draftSummary(session) {
  const steps = (session?.nodes || []).filter((n) => n.type !== 'startEnd')
  const owners = (session?.laneLabels || []).filter(Boolean)
  const first = steps[0]?.data?.label
  const last = steps[steps.length - 1]?.data?.label
  if (!steps.length) return ''
  return `${steps.length} steps across ${owners.length} team${owners.length === 1 ? '' : 's'}` +
    (first && last ? `, from “${first}” to “${last}”.` : '.')
}

export const statusOf = (s) => s?.publish?.status || DRAFT
export const isPublished = (s) => statusOf(s) === PUBLISHED

// Guess a department from the process's own words, so authors aren't made to file
// something before they can publish it. They can always override.
// With one starting department there is nothing to infer — the author picks or
// types the right one in the publish dialog.
export function suggestDepartment() {
  return DEPARTMENTS[0]
}

// A published snapshot: everything a reader needs, frozen.
export function makeSnapshot(session, { department, summary }) {
  return {
    status: PUBLISHED,
    department: department || suggestDepartment(session),
    summary: (summary || '').trim(),
    // What was approved at the moment of publishing. Editing the draft afterwards
    // changes the fingerprint, which is how the studio knows readers have fallen
    // behind — publishing is the approval, so there is nothing else to record.
    fingerprint: fingerprintOf(session),
    publishedAt: new Date().toISOString(),
    // The frozen copy. The draft keeps evolving; readers see this until the next
    // publish, so a work-in-progress edit can never leak to the whole university.
    snapshot: {
      title: session.title,
      laneLabels: session.laneLabels,
      laneRows: session.laneRows,
      nodes: session.nodes,
      edges: session.edges,
      phases: session.phases,
      analysis: session.analysis,
    },
  }
}

// What a reader searches over. Built from the SNAPSHOT, never the draft.
export function searchText(session) {
  const p = session?.publish
  const src = p?.snapshot || session
  return [
    src.title,
    p?.summary,
    p?.department,
    ...(src.laneLabels || []),
    ...(src.nodes || []).map((n) => `${n?.data?.label || ''} ${n?.data?.description || ''}`),
    ...(src.phases || []).map((x) => x.label),
  ].filter(Boolean).join(' ').toLowerCase()
}

// Rank published processes against a plain-language question. Deliberately local
// and instant: a reader asking "how do I hire an intern" should get an answer
// immediately, not wait 2-4 minutes for a model. The AI answer (which explains
// WHERE in the process to start) is layered on top of this, not in front of it.
const STOP = new Set(['how','do','i','a','an','the','to','for','my','we','what','is','are','in','of','and','need','want','should','can','get','with','process','when','where','it','me'])

export function rankProcesses(sessions, question) {
  const terms = String(question || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t))
  if (!terms.length) return []
  return sessions
    .map((s) => {
      const hay = searchText(s)
      const title = (s.publish?.snapshot?.title || s.title || '').toLowerCase()
      let score = 0
      for (const t of terms) {
        if (title.includes(t)) score += 5 // the name of the thing beats a mention
        else if (hay.includes(t)) score += 1
      }
      return { session: s, score }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
}
