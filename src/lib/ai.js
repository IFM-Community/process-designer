// AI client — K2 Aurora (OpenAI-compatible /v1/chat/completions).
//
// Every request is grounded in the skills under /skills — the whole of each file is
// imported at build time and sent as the system prompt, so generated processes
// follow the same conventions we hand-apply (the §0 recipe, lanes = owners,
// shape vocabulary, numbering, gap analysis…) and the same MBZUAI house style.

import { AI_NODE_TYPES } from '../shapes'

// Skills are picked up automatically — drop a new .md under /skills and it joins
// the system prompt on the next reload, no code change needed.
const SKILL_FILES = import.meta.glob('../../skills/**/*.md', { query: '?raw', import: 'default', eager: true })
const rel = (p) => p.replace('../../skills/', '')

// ...but only CONTENT skills are sent to the model. The branding skill is a
// visual-identity spec (colours, fonts, logo placement) and the model's job here
// is to emit JSON, which carries no styling — the app renders that itself. Worse,
// feeding it in measurably derails the answer: it made the model reply with brand
// advice ("use Sand and Navy for the swim lanes") instead of the JSON object, and
// hallucinate a different university. Excluded on purpose; not an oversight.
const isContentSkill = (p) => !/mbzuai-branding/.test(p)

export const LOADED_SKILLS = Object.keys(SKILL_FILES).filter(isContentSkill).map(rel).sort()

const SKILL = Object.entries(SKILL_FILES)
  .filter(([p]) => isContentSkill(p))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, text]) => `===== BEGIN SKILL: ${rel(path)} =====\n${text}\n===== END SKILL: ${rel(path)} =====`)
  .join('\n\n')

// Requests go through the Vite dev proxy (see vite.config.js), which dodges CORS
// AND attaches the Authorization header — the API key lives in .env.local on the
// dev server and is never bundled into the browser.
const API_URL = '/k2/v1/chat/completions'
const MODEL = 'k2moe375B_mid4_v2_6000'

const SKILL_PREAMBLE = `You are a business-process modelling assistant for MBZUAI / IFM.

You MUST follow the skills below. They are the house style.

The process-mapping skill governs the CONTENT of the map: how to turn a raw
description into a swim-lane map (the §0 recipe), what belongs in a lane, which
shape to use, how to number steps, and how to write the gap analysis. Apply it
faithfully — especially §0 (convert, don't transcribe), §1 (lanes = owners who
ACT), §3/§3a (multi-party actions become one step per party), §4 (only mark real
automation), §5 (approve/endorse ⇒ decision shape), §5b (name the system a step
runs in), §6 (only necessary inputs/outputs) and §8 (capture open questions as
OPEN:). Where skills overlap, the process-mapping skill wins on process content.

Never comment on colours, fonts, shapes or visual styling — the app renders all of
that itself. Your entire job is to return the JSON object.

${SKILL}`

const SHAPE_RULES = `
OUTPUT SHAPE RULES (map the skill onto this app's data model):
- "lanes": one entry per owner ROLE that acts. The ORDER of lanes is a layout
  decision, not cosmetic (skill §1a) — get it right, because the app draws lanes
  top-to-bottom in exactly the order you emit and does NOT reorder them:
  · The role that STARTS the process goes in the LAST lane you list (it renders at
    the BOTTOM). Start sits with the first real activity.
  · Order the rest to need as FEW columns as possible: a step and its next step
    should be in ADJACENT lanes whenever you can manage it, because a hop between
    far-apart lanes forces the connector to cross every lane in between and pushes
    later steps into new columns. Put owners who act around the same point in the
    flow next to each other; if the flow marches A→B→C→D through distinct owners,
    list those owners in that adjacency so the walk is monotonic.
  · Approvers/seniors toward the top, the doing team / subject toward the bottom —
    but the two rules above (starter at the bottom, adjacency to save columns) win
    when they conflict with seniority.
  Each lane has id + label.
- Every node has "lane" = a lane id, plus "label" (short) and a unique "id".
- node "type" must be one of: ${AI_NODE_TYPES.join(', ')}.
  · "startEnd" for Start and End (not numbered)
  · "decision" for ANY approve / endorse / review / validate / sign-off
  · "automatedActivity" only when the step is genuinely system-driven
  · "activitySystem" / "automatedActivitySystem" when the step runs in a NAMED
    system — then also set "system". DETECT the system even when unlabelled (§5b):
    known names (Symplicity, e-Services, Banner, a finance/HR system), a "(system)"
    aside in the text, or "in/on/via X". Put the system in "system", NOT the label.
  · "referencedProcess" for a linked separate process
- Give every step (everything except startEnd/dataObject/database) a "numbering"
  like "IHP-01", contiguous in flow order.
- Fill "description" (1-3 sentences). Use "input"/"output" ONLY where a real
  artefact is consumed/produced, otherwise "-". Put unresolved questions in the
  description prefixed "OPEN:".
- "edges" connect the whole flow. Label a decision's branches only when a branch
  genuinely routes somewhere different (e.g. "Yes"/"No"); a forward-only gate needs
  no label.
- "analysis": the gap-analysis box as an ARRAY OF STRINGS (free-form lines).
  Use "1. Heading" lines for groups and "- point" lines for bullets, per §10 and
  §0. Include the open questions the description raised.

Respond with ONE JSON object and nothing else — no prose, no markdown fences:
{"title": string, "lanes": [{"id": string, "label": string}],
 "nodes": [{"id","type","lane","label","numbering","description","input","output","duration","system"}],
 "edges": [{"source","target","label"}],
 "analysis": [string]}`

function extractJson(text) {
  if (!text) throw new Error('The model returned an empty response')
  let t = String(text).trim()
  // strip ```json ... ``` fences if present
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  // fall back to the outermost { ... }
  if (!t.startsWith('{')) {
    const s = t.indexOf('{')
    const e = t.lastIndexOf('}')
    if (s !== -1 && e > s) t = t.slice(s, e + 1)
  }
  try {
    return JSON.parse(t)
  } catch {
    throw new Error('Could not parse the JSON returned by the model')
  }
}

// The model occasionally returns well-formed JSON that puts the steps under a
// different key (or nests them), which used to surface as a silently empty board.
// Accept the common variants, then insist there is actually something to draw.
function normalizeSpec(spec) {
  const s = spec?.process || spec?.map || spec || {}
  const nodes = s.nodes || s.steps || s.activities || s.tasks || []
  const edges = s.edges || s.flows || s.connections || s.transitions || []
  const lanes = s.lanes || s.swimlanes || s.owners || s.roles || []
  if (!Array.isArray(nodes) || !nodes.length) {
    throw new Error('The model returned a map with no steps. Try rephrasing, or run it again.')
  }
  return { ...s, lanes, nodes, edges, analysis: s.analysis || s.gaps || [] }
}

// K2 is a reasoning model and it thinks HARD — a full process map costs ~15k
// completion tokens, of which the overwhelming majority is internal reasoning
// that never reaches `content`. Two consequences we have to design around:
//   1. max_tokens must cover reasoning + answer. Set it too low and the budget is
//      spent thinking, the reply comes back with content:"" and
//      finish_reason:"length", and the UI looks like it "generated nothing".
//   2. A call legitimately takes 2-4 minutes. Anything faster is not on offer;
//      `reasoning_effort: "low"` is accepted but ignored by this deployment.
const MAX_TOKENS = 30000
const TIMEOUT_MS = 8 * 60 * 1000

async function callModel({ system, prompt, json = true, signal }) {
  // Never hang forever: without this a stalled request spins the button for good.
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  if (signal) signal.addEventListener('abort', () => ctl.abort(), { once: true })

  let res
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      signal: ctl.signal,
      headers: { accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    })
  } catch (e) {
    if (e.name === 'AbortError') {
      // Two ways the fetch aborts: the user pressed Stop, or the 8-minute timeout
      // fired. Tell them apart so a deliberate Stop isn't reported as an error.
      if (signal?.aborted) { const err = new Error('Stopped.'); err.aborted = true; throw err }
      throw new Error(`The model did not answer within ${TIMEOUT_MS / 60000} minutes. Try a shorter description.`)
    }
    throw new Error(`Could not reach the K2 Aurora endpoint (${e.message}). Is the dev server proxy running?`)
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    let detail = ''
    try { detail = JSON.stringify(await res.json()) } catch { detail = await res.text().catch(() => '') }
    throw new Error(`API error ${res.status}: ${detail.slice(0, 300)}`)
  }
  // The /k2 proxy is configured in vite.config.js, which Vite reads ONCE at
  // startup. A dev server that was already running when the proxy (or .env.local)
  // was added has no /k2 route, so Vite's SPA fallback answers with index.html —
  // a 200 that isn't JSON. Say that plainly instead of dying on a parse error.
  const ctype = res.headers.get('content-type') || ''
  if (!ctype.includes('json')) {
    throw new Error(
      'The /k2 proxy is not active — the dev server answered with a page, not the API. ' +
      'Restart the dev server (vite.config.js and .env.local are only read at startup).',
    )
  }
  const data = await res.json()
  const choice = data?.choices?.[0]
  const text = choice?.message?.content ?? ''
  // Ran out of budget mid-thought: say so plainly instead of failing on a parse.
  if (!text.trim() && choice?.finish_reason === 'length') {
    throw new Error('The model used its whole token budget reasoning and returned no answer. Try a shorter, simpler description.')
  }
  return json ? extractJson(text) : text
}

// The three calls that return a MAP all normalize + validate the result.
const mapCall = (opts) => callModel(opts).then(normalizeSpec)

// Prompt → full process map, built to the skill.
export function generateProcess({ prompt, signal }) {
  return mapCall({
    signal,
    system: `${SKILL_PREAMBLE}\n${SHAPE_RULES}`,
    prompt: `Build the swim-lane process map for the description below, applying the
§0 recipe: convert it, don't transcribe. Answer any bracketed questions with a
recommendation (and keep what stays unresolved as OPEN: / in the analysis), give a
lane only to parties that ACT, split multi-party actions into one step per party,
and factor shared steps out of end-scenarios instead of duplicating them.

PROCESS DESCRIPTION:
${prompt}`,
  })
}

// Instruction + the map you're looking at → a revised map.
// The whole spec goes in and the whole spec comes back, so the model can move a
// step to another lane, re-number, add a branch… but it's told to change ONLY what
// the instruction asks for and keep every other step's id, wording and lane intact.
export function editProcess({ instruction, spec, signal }) {
  return mapCall({
    signal,
    system: `${SKILL_PREAMBLE}\n${SHAPE_RULES}`,
    prompt: `Below is an EXISTING swim-lane process map, followed by an instruction
from the process owner. Apply the instruction and return the COMPLETE revised map
in the same JSON shape.

Rules for editing:
- Change only what the instruction asks for. Every step the instruction doesn't
  touch must keep its id, label, lane, description and other fields EXACTLY as-is.
- Reuse existing node ids; invent new ids only for genuinely new steps.
- Preserve existing edge labels verbatim (e.g. a decision's "Yes"/"No" or threshold
  branches). Never silently drop one — an unlabelled branch loses its meaning.
- After the edit, re-check the result against the skill: numbering must stay
  contiguous in flow order, edges must still connect the whole flow end-to-end, and
  any new step needs the right shape (approve/endorse ⇒ decision) and owner lane.
- Keep the existing "analysis" lines unless the instruction changes something they
  describe; then update just those lines.

CURRENT MAP:
${JSON.stringify(spec, null, 2)}

INSTRUCTION:
${instruction}`,
  })
}

// Procedure table → process map (keeps the given steps, re-infers the flow).
export function mapFromTable({ title, lanes, rows, signal }) {
  return mapCall({
    signal,
    system: `${SKILL_PREAMBLE}\n${SHAPE_RULES}`,
    prompt: `Rebuild a swim-lane process map from this procedure table. Keep the SAME
steps, their responsibilities (which become the owning lane) and their table fields
(description/input/output/duration). Infer the correct flow: order the steps, connect
them with edges, and place each step in the lane matching its responsibility. Add
Start and End if missing. Apply the skill's shape rules (approve/endorse ⇒ decision).

Process title: ${title || 'Untitled process'}
Lanes (owners), top-to-bottom: ${JSON.stringify(lanes)}

Steps (in current table order):
${JSON.stringify(rows, null, 2)}`,
  })
}

// Map → the per-step table fields (description / input / output / duration).
//
// Editing a map is quick; keeping every step's write-up in step with the edit is
// not, so those fields drift out of date and the table stops describing the
// picture. This regenerates them FROM the current map, so they always describe
// what is actually drawn. It only ever returns text fields — never the structure.
export function fillDetails({ spec, onlyBlank, signal }) {
  return callModel({
    signal,
    system: `${SKILL_PREAMBLE}

You are filling in the per-step table fields for an EXISTING process map. You must
NOT change the process: no new steps, no deletions, no re-wiring, no re-numbering,
no lane or label changes. Return text fields only, keyed by the step's id.

Follow §6 strictly: give "input"/"output" ONLY where a real artefact is genuinely
consumed or produced by that step (a form, a contract, a report, a system record).
Where there is none, return "-". Do not invent documents to fill the column.

- "description": 1-3 sentences, concrete, in the map's own vocabulary. Say what the
  owner actually does at this step. Never restate the label.
- "duration": a realistic elapsed time ("2 days", "1 week") only if the map or the
  step makes it inferable; otherwise "-". Never invent an SLA.
- "system": the named system this step runs in, per §5b — DETECT it from the
  source even when nobody labelled it: known names (Symplicity, e-Services, Banner,
  a finance/HR system), a "(system)" aside, or "in/on/via X". Return "" when no
  system is evident. Never invent one.
- Anything the map leaves genuinely undecided goes in the description prefixed
  "OPEN:" rather than being guessed (§8).

Respond with ONE JSON object and nothing else:
{"nodes": [{"id": string, "description": string, "input": string, "output": string, "duration": string, "system": string}]}`,
    prompt: `Write the table fields for every step in the map below.${
      onlyBlank
        ? '\n\nONLY fill fields that are currently empty or "-". If a field already has text, return it EXACTLY as it is.'
        : '\n\nRefresh every field so it matches the map as it now stands — existing text may be out of date after edits.'
    }

Use the edges to understand each step's place in the flow: what reaches it, what it
hands on, and which branch it sits on. A step's input is usually what its
predecessor produced.

CURRENT PROCESS MAP:
${JSON.stringify(spec, null, 2)}`,
  })
}

// Map → process brackets ("phases"): the 4-6 stage story a detailed map tells.
//
// Groups EXISTING steps; it never invents, deletes or reorders them. The result is
// a set of phases plus which step belongs to which, so the map can show a bracket
// band and collapse each stage into one block.
export function groupIntoPhases({ spec, signal }) {
  return callModel({
    signal,
    system: `${SKILL_PREAMBLE}

You are grouping an existing process map into PROCESS BRACKETS (phases) — see §11
of the skill. A phase is a STAGE OF THE FLOW, not an owner: it cuts across every
lane it touches. The point is that someone can describe the whole process as
"1 … 2 … 3 …" without reading the steps.

Rules:
- 4-6 phases. Fewer than 4 says nothing; more than 6 is not a summary.
- Phases are SEQUENTIAL and CONTIGUOUS in flow order. Every step in phase 2 comes
  after every step in phase 1. Never interleave.
- EVERY step must belong to exactly one phase, EXCEPT "startEnd" nodes (Start and
  End). Those are punctuation, not work — leave them out of "assign" entirely.
- If the process has alternative endings or exception paths (extended / converted /
  rejected), make each its OWN phase rather than folding it into a main-path stage:
  they are alternatives, not successors.
- Name a phase as an ACTION-NOUN (gerund), the house convention the People &
  Culture manual uses for its own processes: "Job Posting", "Candidate
  Interviewing". So "Contract signing", "Stipend processing", "Internship
  close-out" — NOT imperative verbs ("Sign the contract", which is how STEPS are
  written), NOT bare states ("Signed contract"), NOT "Phase 2".
- Cut where the process genuinely changes gear — a new artefact appears, the work
  hands over to a different group, or a distinct outcome is reached.

Respond with ONE JSON object and nothing else:
{"phases": [{"id": "p1", "label": "Identify the request"}, …],
 "assign": {"<stepId>": "p1", …}}
"assign" must contain an entry for EVERY step id given to you.`,
    prompt: `Group the steps of this process map into 4-6 sequential phases.

Read the edges to get the true flow order, then find where the process changes
gear. Return every step id in "assign".

CURRENT PROCESS MAP:
${JSON.stringify(spec, null, 2)}`,
  })
}

// Re-name the stages from what they NOW contain — grouping untouched.
//
// After dragging steps between stages, the names describe the old membership. This
// renames only: it never moves a step, never adds or removes a stage. Separated
// from grouping on purpose, so fixing a name can't quietly redesign the grouping
// you just did by hand.
export function renamePhasesFromSteps({ stages, title, signal }) {
  return callModel({
    signal,
    system: `${SKILL_PREAMBLE}

You are naming the stages of a process that has ALREADY been grouped. Do NOT
regroup: the membership is fixed and is not yours to change.

Name each stage as an ACTION-NOUN (a gerund phrase) — the house convention, the one
the People & Culture manual uses for its own processes: "Job Posting", "Candidate
Interviewing", "Compensation Management".

So: "Contract signing", "Stipend processing", "Internship close-out",
"Request identification & endorsement".
NOT imperative verbs ("Sign the contract") — the STEPS are already written that way,
and stages must read as a different level, not the same one.
NOT bare outcome states ("Signed contract") — that names what is left behind rather
than the work the stage contains.
NOT "Phase 2", not "Approval steps".

Rules:
- 2-5 words, in the process's own vocabulary. A reader who sees only the stage
  names should be able to follow the whole process.
- Name the WORK the stage does, in gerund form.
- Keep the names distinct; if two stages would get the same name, the difference
  between them is exactly what each name has to capture.
- Return a name for EVERY stage id you are given.

Respond with ONE JSON object and nothing else:
{"names": {"<stageId>": "Stage name", …}}`,
    prompt: `Name each stage of "${title || 'this process'}" from the steps it now contains.

STAGES (with their current steps, in flow order):
${JSON.stringify(stages, null, 2)}`,
  })
}

// Process → a suggested process CODE.
//
// The model is choosing five short segments from an existing scheme, not inventing
// a taxonomy: an author who has drawn a Paris intern process should not have to
// remember that Paris is PAR. Every field stays editable afterwards — this is a
// first guess, not a ruling.
export function suggestProcessCode({ spec, segments, signal }) {
  return callModel({
    signal,
    system: `${SKILL_PREAMBLE}

You assign a process code. The scheme has five segments:

${segments.map((s) => `${s.key} (${s.label}) — ${s.hint}. Known values: ${s.options.map(([v, l]) => `${v}=${l}`).join(', ')}`).join('\n')}

Rules:
- Prefer a KNOWN value when one fits. Invent a new 2-4 letter uppercase code only
  when nothing in the list describes this process.
- Read the whole map, not just the title: the lanes say which part of the
  organisation owns it, the steps say what the process is.
- If the title marks a version — current, as-is, proposed, target, redesign — the
  variant segment must reflect it.
- Every segment must be filled.

Respond with ONE JSON object and nothing else:
{"entity":"...","group":"...","process":"...","location":"...","variant":"..."}`,
    prompt: `Assign the process code for this process.

${JSON.stringify(spec, null, 2)}`,
  })
}

// Process → the one line a reader sees in the library.
//
// Short on purpose. This sits under a title in a gallery card; a paragraph there
// is not read at all, so anything longer than a sentence is worse than nothing.
export function summarizeProcess({ spec, signal }) {
  return callModel({
    signal,
    system: `${SKILL_PREAMBLE}

Write ONE sentence describing what a process is for, for someone browsing a
library of university processes who has never seen it.

Rules:
- ONE sentence, under 20 words.
- Say what it lets the reader DO, not what the document is. "How to hire, contract
  and pay an intern at IFM." NOT "This process map documents the intern hiring
  workflow."
- Plain words. No "streamline", "end-to-end", "leverage", "facilitate".
- Do not name the owners or count the steps — the card already shows those.
- No quotes around it, no trailing commentary.

Respond with ONE JSON object and nothing else:
{"summary": "..."}`,
    prompt: `Write the one-line description for this process.

${JSON.stringify(spec, null, 2)}`,
  }).then((r) => (r?.summary || '').trim())
}

// Process → concise gap analysis (skill §10), returned as free-form outline lines.
export function analyzeGaps({ spec, signal }) {
  return callModel({
    signal,
    system: `${SKILL_PREAMBLE}

You are producing ONLY the gap-analysis box described in §10 of the skill.

Interrogate the process from each of §10's seven angles and report the ones that
actually bite. Follow §10's shape EXACTLY — it is the whole point of this task:

  Short verdict — the evidence for it across the whole process.

The verdict judges a PATTERN. The evidence then summarises the WHOLE MAP in one
sentence. One line per angle, no headings, no sub-bullets.

Work through ALL SEVEN angles and report every one that bites — usually six or
seven of them. Brevity is about each LINE, not about dropping angles: an omitted
angle is a gap the reader never hears about. The clock/measurement one (no SLA on
any step, no KPIs) is nearly always true of an as-is process and nearly always
worth its line.

Three hard rules:

1. AGGREGATE. Do NOT produce step-level findings ("IPN-02 has no No branch",
   "IPN-10 hands off to IPN-11 without a system"). Those are observations, not a
   diagnosis. Every rejection path missing is ONE line about exceptions; every
   manual step is ONE line about manual effort.
2. The SUBJECT of every sentence is a pattern, never a step. "The contract step is
   broken" is wrong even when true — the right line names the pattern that step
   illustrates ("Some steps have no clear outcome — …"), with the step as a
   parenthetical example at most.
3. NO OVERLAP. Each line covers a different angle. Two lines that both amount to
   "there is a lot of manual work" are one line; merge them and use the space for
   an angle you have not covered.

Keep each line SHORT — 30 words at the outside. If it runs longer you are
narrating the map instead of judging it. Cut the enumeration, keep the verdict and
the sharpest two or three pieces of evidence.

Be blunt and plain. "Almost none of it needs a person" beats "significant
automation potential exists". A line that could be pasted into any process map is
only worth writing if it is true here AND carries this process's specifics.

This is the standard to hit (a real analysis of an as-is intern process):
Too much manual effort — documents checked by hand, contracts filled, signed and emailed manually, data re-keyed at every step. Almost none of it needs a person.
No system — it runs on email, has no e-signature, and dead-ends at payment, so the intern is never recorded anywhere.
Owners are people, not roles — and the departments involved (academic supervisor, Student Finance, faculty, visa) are never formally consulted or informed.
No exceptions or close-out — nothing for extensions, conversions or rejections, and no onboarding or evaluation after payment.

Respond with ONE JSON object and nothing else:
{"analysis": [string]}
one string per line, in the "Verdict — evidence" form above.`,
    prompt: `Analyze the gaps and areas of improvement in the process map below.

Work in two passes.

FIRST, read the whole map and count the patterns — how many steps are manual, how
many name a system, how many decisions lack a second branch, how many owners are
named people rather than roles, which parties never appear, where the flow simply
stops. Read the edges as well as the steps.

THEN write one line per pattern, not one line per step. Each observation you made
is evidence for a theme; the line states the theme and summarises the evidence.
Ten manual steps are not ten findings — they are one line saying the process runs
on manual effort, and naming what that effort actually is.

Every line must be true of THIS map and carry its specifics (the real systems,
parties, documents and dead-ends), never generic process advice.

CURRENT PROCESS MAP:
${JSON.stringify(spec, null, 2)}`,
  })
}
