# Process Mapping Skill — turning raw material into a table + swim-lane map

Conventions for converting rough notes, emails, or a procedure manual into a
clean process (both the table and the swim-lane map). These are the lessons
learnt from the P&C Procedure Manual and the Intern Process work — apply them
whenever you build or edit a process in this app.

## 0. THE RECIPE — from a raw brain-dump to a finished map
The most common input is a stakeholder dumping thoughts as `Actor: action` lines
with questions in brackets. Don't transcribe it — **convert** it. Run these steps
in order; each one is expanded in the sections below.

1. **Actors → lanes, actions → steps.** Every `Actor: action` line is a candidate
   step; the actor becomes a lane (§1). **Order the lanes deliberately (§1a):** the
   role that starts the process at the **bottom**, approvers rising above it,
   owners who act at the same stage in adjacent lanes so the map needs as few
   columns as possible. Start/End go in the lane of the step they touch (§1b).
2. **Filter the actors — not every named party earns a lane.**
   - A party that **acts in the workflow** → a lane.
   - Someone who merely **supplies a document** → that document becomes an
     *input* to the step that consumes it, no lane. *(The faculty advisor's NOC
     became a file the Student uploads, not an advisor lane — §6.)*
   - **"System"** is never a lane → use the **Automated Activity** shape (red "A")
     in the owning team's lane, and name the system in the Sand band (§4, §5b).
3. **Answer the questions in the dump — they are the highest-value content.**
   A bracketed question ("is this a step?", "is human effort needed?", "are the
   systems connected?") is a **design decision to make with a recommendation**,
   not text to copy. Resolve each one and say why. Examples from the intern dump:
   - *"Student submits info — is it a step?"* → yes, but a light **form** step,
     not an approval.
   - *"HR endorses details — is human effort needed?"* → **no**: replace with an
     automated budget/policy/completeness check; HR handles exceptions only.
   - *"University Finance registers salary — are systems connected?"* → model it
     automated **and** flag `OPEN:` that it depends on a Symplicity↔Finance link.
   Anything genuinely unresolved goes into the step description as `OPEN:` (§8)
   **and** surfaces in the gap-analysis box as an open question (§10).
4. **Collapse multi-party actions into one step per party** (§3/§3a) — "HoO /
   Student / CSI sign" becomes three signing steps, one per lane.
5. **Factor the end scenarios — never duplicate shared steps.** A dump that lists
   "scenario 1 / 2 / 3" tempts you into three parallel tails. Instead pull out
   what they share and express the variants as **sequential decisions**. The three
   intern endings (on-time / extend / convert) became: `Extend internship?` →
   (endorse → approve) → **one** shared `Off-board & complete evaluation` →
   `Convert to full-time?` → referenced *Full-time hiring process* or End.
6. **Apply the shape vocabulary**: approve/endorse ⇒ decision diamond (§5a);
   truly system-driven ⇒ Automated Activity (§4); a linked separate process ⇒
   Referenced Process; the system a step runs in ⇒ the +System shape (§5b).
7. **Number contiguously** (§2) and let the layout pack vertically (§7).
8. **Attach a gap analysis** (§10) — the seven angles, plus every `OPEN:` question
   the dump raised.

**Litmus test for a finished map:** every lane is a party that acts; no step is a
verbatim copy of a question; shared steps appear once; automation and systems are
visible at a glance; **every step is wired into the flow — walk it from Start and
you can reach every box, and each step's number is one more than the step before
it on its chain**; and the unresolved questions are captured in the analysis box
rather than lost.

**Before returning a map, check the edges, not just the steps.** Generation gets
the *steps* right far more reliably than the *connections*. Two failures to look
for, because they are invisible until the map is drawn:
- a step with **no incoming edge** (it lands at the far left, numbered last);
- a step wired to the wrong predecessor (the map is then faithfully, confidently
  wrong — no amount of re-tidying will fix it, because layout never rewires flow).

**Return the map, not commentary about it.** The output is one JSON object. Never
emit colours, fonts, shape styling or brand advice — the app renders all of that
and the caller's schema has nowhere to put it. Feeding a *visual-identity* skill
into a map-generation prompt is what caused this: the model replied with styling
prose instead of JSON, and invented a university that wasn't in the brief. Keep
content skills and branding skills apart.

## 1. Lanes = owners (roles), one row per owner
- A lane is a **role/owner**, not a person's mood or a phase. Name it by the
  accountable party (e.g. "Careers Team (CSI)", "IFM", "Student Finance").
- Put a step in the lane of whoever **performs** it.
- **An owner with nothing to do is not a lane.** Only emit a lane if a step
  actually lands in it. This matters most on an EDIT: when an instruction removes
  the last step an owner had ("delete process 002", "merge the two signing steps"),
  that owner's lane must go too — a lingering empty band reads as "this role is
  still involved" when it no longer is. Never keep a lane just because the previous
  version had it. *(Enforced in `specToBoard`, which drops any lane no step uses.)*

### 1a. Lane ORDER is a layout decision — choose it deliberately
Lane order is not cosmetic. Because a column can hold at most one step per lane,
the order you put the owners in decides how many columns the map needs and
whether connectors run cleanly. Two rules, in priority order:

1. **The role that STARTS the process goes in the BOTTOM lane** (e.g. IFM
   Technical Team), with approvers/reviewers stacked above it and the most senior
   / most removed parties at the top. The flow then reads as rising to an approval
   and coming back down, which is the shape people expect. Board numbering runs
   bottom-up (#1 is the bottom lane).
2. **Then order the remaining lanes to need as FEW columns as possible** — without
   ever creating an overlap. Steps that happen at the same stage but belong to
   different owners share a column, so put owners who act *around the same point
   in the flow* in **adjacent** lanes. Two consequences worth planning for:
   - A run of hops between owners far apart in the lane order forces the vertical
     connectors to travel over the lanes in between, which reserves those lanes
     and pushes later steps into new columns (§7). Neighbouring lanes don't.
   - A **non-monotonic** run (up, then down, then middle) can never share one
     column (§7). If the sequence is genuinely flexible — independent signatures,
     say — order those lanes so the run becomes monotonic.

Fewer columns is the goal, but **never at the price of an overlap**: a compact map
with an arrow through a box is worse than a wider clean one.

### 1b. Start and End belong to the step they touch
`Start` goes in the lane of the **first activity**, and `End` in the lane of the
step that precedes it — never in a lane of their own choosing. A Start sitting in
an unrelated owner's lane silently asserts *that* owner begins the process. We
shipped a map whose Start sat with the Student while the first real activity was
owned by the IFM Technical Team; it read as if the student kicked off hiring.
Enforced in code (`terminatorLanes` in [src/lib/layout.js](src/lib/layout.js)), for
both generated maps and **Tidy & number** — the single lane tidy is allowed to
change, since every other lane is the user's own call.

### 1c. Step LABELS — imperative, parallel, and NEVER echoing the owner

A step label names the ACTION. The lane already names who does it, so the label
must not repeat the owner, and every label in a map must read in the same
grammatical shape. This is not cosmetic — inconsistent labels make a map look
unfinished and make two comparable steps look different.

**The four rules, in order of how often they're broken:**

1. **Never repeat the lane/owner in the label.** The step sits in the "Student"
   lane, so the reader already knows the Student does it. Write the verb phrase
   only.
   - ✗ "Student adds internship and required information to the system"
   - ✓ "Add internship details to Symplicity"
   (the system goes in the Sand band, §5b — not in the label either.)

2. **Start with an imperative verb, present tense.** Not a gerund, not past tense,
   not a noun. The whole map must be parallel: if one step is "Submit request",
   another must not be "Endorsement" or "Endorsed" or "Endorsing".
   - ✗ "Identify hiring request and identified candidates" (mixed tense, two verbs)
   - ✓ "Identify the hiring request"
   - ✗ "Endorsed" / "Endorsement" / "Endorsing" → ✓ "Endorse the request"

3. **One action per step.** A label with "and" is usually two steps (§0, step 4).
   If it must stay one, keep the dominant verb: "Add internship details" not
   "Add internship and required information and NOC to the system".

4. **Be concise — aim for 2–5 words**, ≤6. Drop filler ("to the system", "in
   order to", "the process of"). The code carries identity; the label carries the
   action. "Register salary in Finance system" → "Register salary" (the system is
   the Sand band).

**Litmus test:** read every label in the map as a flat list. They should scan as
one parallel series of commands — *Identify the request · Endorse it · Complete
the request · Add student details · Validate · Generate contract …* — with no
owner names, no tense drift, no two-verb steps. If one label breaks the rhythm,
it's the one to fix.

Enforced for GENERATED and AI-EDITED maps: the model is instructed to apply these
rules to every step it writes or rewrites, and to fix pre-existing labels that
violate them when it touches a map.

## 2. Numbering

### 2a. THE CODE SCHEME — `IFM-RCN-INT-AD-CRN-001`
A step's code says **where the process lives**, not just where the step sits in it.
Six segments, hyphen-separated, most-general to most-specific:

| Segment | Example | Means |
|---|---|---|
| Entity | `IFM` | which part of the organisation owns it |
| Process group | `RCN` | the family it belongs to — Recruitment |
| Process | `INT` | the process itself — Intern |
| Location | `AD` | where it runs — Abu Dhabi |
| Variant | `CRN` | which version — Current (as-is) |
| Step | `001` | sequential in flow order, three digits |

**Why it is worth the length.** The same step in another site or another version
gets a code that lines up beside it:

- `IFM-RCN-INT-AD-CRN-007` — Abu Dhabi, as-is
- `IFM-RCN-INT-PAR-CRN-007` — the same step in Paris
- `IFM-RCN-INT-AD-TGT-007` — what it becomes in the target design

So "-007" is discussable across a whole manual without ambiguity, and a code is
never reused by a different process. A bare `INT-01` cannot do this: three
variants of one process all claim it.

Suggested tokens (free text — invent one when the list doesn't fit):
- **Group**: `RCN` recruitment · `ONB` onboarding · `PER` performance ·
  `CMP` compensation · `LRN` learning · `EXT` exit · `HCS` HC strategy · `OPS` operations
- **Process**: `INT` intern · `FTE` full-time hire · `CTR` contractor ·
  `PST` job posting · `IVW` interviewing · `OFR` offer
- **Location**: `AD` Abu Dhabi · `PAR` Paris · `SVL` Silicon Valley · `GLB` all sites
- **Variant**: `CRN` current (as-is) · `PRP` proposed · `TGT` target design · `NEW` new

Rules:
- Keep segments **short and uppercase** (2–4 characters), and use the *same* token
  for the same thing everywhere — `AD` is always Abu Dhabi, never `AUH` as well.
- A half-filled scheme is fine: blank segments are skipped, so `INT-AD-CRN-001`
  works while the rest is still being decided.
- The step number is **three digits from 001**, contiguous, in flow order (§2b).
- Set it once per process; every step inherits it. In the app it's the **Process
  code** panel in the sidebar, and **Tidy & number** applies it to every step
  ([src/lib/processCode.js](src/lib/processCode.js)).
- **Renumbering does NOT rewrite prose.** Descriptions and the gap-analysis box
  quote codes as text ("no rejection path at INT-05"), and those references go
  stale the moment the scheme changes. Re-code early, before the write-up exists —
  and if you re-code later, re-read the analysis and descriptions for old codes.

### 2b. Sequence
- Every work step gets a stable code (e.g. `IFM-RCN-INT-AD-CRN-001`, `IPN-01`).
- The table is **sorted by this number**. Keep numbers contiguous after edits —
  if you insert steps, renumber the downstream ones.
- Start/End, Data Object and Database shapes are NOT numbered and do NOT appear
  in the table (they live on the map only).
- **Decisions and referenced processes ARE numbered steps.** They take a code like
  any other step, and the code must be *visible* on the shape. Numbering them
  silently is a bug we shipped once: `renumberByFlow` gave decisions codes but the
  canvas and the export both refused to draw them, so the visible sequence read
  `01, 03, 04, 05, 06, 10, 11, 13…` — every gap was an invisible decision. Readers
  conclude the flow is broken and start hunting for a step that was never missing.
- **Number ALONG THE CHAIN, not across the board.** After a step, the next number
  goes to one of *its own* successors; only when a chain dead-ends do you go back
  and pick up whatever is still unnumbered. Consecutive steps must get consecutive
  codes.
  - The bug this replaced: a plain topological walk tie-broken by board position.
    Every decision makes several steps "ready" at once, and picking the left-most
    one *anywhere on the board* hops between branches — so a step and its direct
    successor came out as `IHP-02 → IHP-12` and `IHP-07 → IHP-16`. Technically a
    valid ordering; unreadable as a process.
  - A branch legitimately jumps **once**: after a decision's first branch is
    numbered through to its end, the second branch starts at the next free number
    (`IHP-13 → IHP-18` is fine if 14–17 are the other branch). One jump per
    branch point is expected; a jump on the *main chain* is a bug.

## 3. Multi-party sign-off → one approval step PER approver, sequenced
When source material says something like *"approved by CSI, Faculty & IFM"* or
*"requires sign-off from all three parties"*, do **not** collapse it into a
single shared decision. Draw **one approval step per approver**, each a decision
shape **in that approver's own lane**, chained in sequence:

```
… → [Approve — CSI] → [Approve — Faculty] → [Approve — IFM] → …
        (csi lane)      (faculty lane)        (ifm lane)
```

- This makes each party's accountability visible in its lane and shows the real
  order of the sign-offs (the arrows cross lanes vertically).
- Use the **decision shape** for review/approve/endorse steps (matches the HC
  Strategic Planning sample, where "Review", "Approve", "Endorse" are diamonds).
- Don't add Yes/No branches unless a rejection genuinely routes somewhere; a
  plain chained approval just flows to the next step. (See §5.)
- **Order matters — never guess it.** The sequence must follow the real-world
  order of who signs first (e.g. the intern process is IFM → CSI → Faculty, not
  an arbitrary lane order). If the source doesn't state the order, flag it
  `OPEN:` rather than inventing one. *(Learned when the New intern process was
  first built with the approvals in the wrong order.)*
- **The same rule applies to any multi-party action, not just approvals.** A
  document "signed by 3 parties" (e.g. a tripartite agreement signed by IFM, the
  Student and CSI) becomes **one signing step per signatory**, stacked in a
  signature column — name each signatory instead of writing a vague
  "sign (3 parties)". Spell out *who* the parties are.

### 3a. Multi-party signing — the recommended pattern (reference)
> **One sign task per party, in each party's lane — this is the clearest and the
> standard for swim-lane maps**, because the whole point of lanes is to show who
> does what. Never use a single "Sign (3 parties)" box. A tripartite agreement
> becomes three "Sign agreement" boxes — one in the IFM-supervisor lane, one in
> the Student lane, one in the CSI lane — each its own step with an owner.

**Then choose sequential vs parallel by whether order matters:**
- **Sequential** — the connector runs lane → lane → lane (IFM signs, then
  Student, then CSI countersigns). Use when there's a **required order**. This is
  the default and what the New intern process uses.
- **Parallel** — one point **splits into concurrent "sign" branches that merge
  back** once all are done. Use when parties can sign **independently but all
  must finish** before the flow continues. In classic BPMN this is an **AND /
  parallel gateway**: a diamond with a "+" to split and another to join. (This
  tool has no dedicated parallel-gateway shape yet — represent the split/join
  with a `decision` node labelled "+" at each end, or keep it sequential and note
  `OPEN: signatures can be parallel`.)

Default to sequential unless the source says signing is independent/concurrent.

## 4. Automation — only mark what is actually automated
- Use the **Automated Activity** shape (red "A") **only** when the step is truly
  system-driven today (e.g. "the portal generates the agreement automatically").
- If a process is done manually today, keep every step a plain **Activity** —
  do not mark it automated just because it *could* be. ("If we do it manually,
  keep it manual, not automated yet.")
- Keep a "current" (as-is, manual) process separate from a "new/proposed" one
  that introduces automation.

## 5. Decision SHAPE vs "no" BRANCH — two separate calls
Keep these two decisions apart; conflating them was a mistake.

**(a) The shape — use the DECISION diamond for every judgment/gate.** If a step
is an **approve / endorse / review / validate / sign-off**, it is a decision
shape — no-brainer. The keyword *approve* or *endorse* in a label ⇒ diamond,
always. The diamond signals "a judgment is exercised here", which is exactly what
an approval is (it matches the HC Strategic Planning sample, where every Review /
Approve / Endorse is a diamond). Do **not** demote an approval to a plain
activity just because you aren't drawing its reject branch — that loses the
signal that a gate exists. A step that involves **no** judgment and always
continues (e.g. "Run internship", "Mark satisfactory/unsatisfactory then
proceed") is an **activity**.

**(b) The "no" branch — optional, drawn only when it earns its place.** Whether a
decision shows its rejection arrow is independent of its shape. For cleanness a
gate may be a **forward-only decision** — a diamond with just the onward arrow,
no "No" branch — when the rejection would merely re-join the normal path or lead
nowhere new. Note the omitted path in the gap analysis instead of cluttering the
map. Add the "No" branch back only when the rejection routes somewhere that
genuinely needs to be seen. *(So: "Endorse extension" is a **decision diamond**
that flows forward — a gate whose reject path is deliberately not drawn.)*

- **Decision branches: keep the skip-branch clear of the other branch's boxes.**
  A decision's "no/skip" arrow runs horizontally to where its branches rejoin. If
  that arrow shares a lane with the *other* branch's first step, it will be drawn
  straight through that box. Fix by making the two branches start in **different
  lanes** — e.g. fold "Submit extension" into the "Extend?" decision so the
  extension's first drawn step is the Tech-Head endorsement (a different lane),
  leaving the "No" arrow to reach off-boarding with nothing in its path. *(Learned
  on the Target intern process: the Conclude arrow ran through "Submit extension".)*

## 5b. Naming the system a step runs in
When it matters *which system* a step happens in (Symplicity, e-Services, a
finance system…), use the **Activity + System** or **Automated + System** shape —
same box, plus a Sand band at the bottom naming the system (double-click the band
to edit). Prefer this over burying the system in the description when the system
is a first-class fact of the process (e.g. "everything on the portal" vs "this
one step is on a separate finance system"). The plain Activity / Automated shapes
stay for steps where the system is irrelevant or unknown.

**Detecting the system from the raw material — do NOT wait to be handed a field.**
People record the system however they happen to write; there is no fixed
convention, so INFER it. In order of reliability:

1. **Known system names anywhere in the text.** Treat these as the system for that
   step whenever they appear (case-insensitive): **Symplicity**, **e-Services**
   (also "eServices"), **Banner**, plus any obvious system word the source uses —
   "the finance system", "the HR portal", "SAP", "Workday", "SharePoint". This
   list is a starting point, not a whitelist: a capitalised product name used as
   "in/on/via X" is almost always the system.
2. **Parenthetical asides.** Many authors jot the system in brackets —
   "Add student details (Symplicity)", "Approve (in Banner)". Pull the system out
   of the "(…)", put it in the Sand band, and remove it from the label (§1c: the
   label is the action only).
3. **Prepositions.** "…in Symplicity", "…on e-Services", "…through Banner",
   "uploads to the portal" → the object of in/on/through/via/to is the system.

When a step names a system, switch its shape to **Activity + System** (or
**Automated + System** if the system does it) and fill the Sand band. When no
system is evident, use the plain shape and leave the band empty — never invent a
system that isn't in the source.

The write-up/fill step (§6a) applies the same detection: reading the map + source,
it should populate the system band for steps whose material names a system, not
just the description.

## 6. Inputs / outputs — only the necessary ones
- Most steps do **not** need a full input AND output. In the manual, many are
  "-". Fill an input/output only where a real artefact is produced or consumed
  (a portal record, a signed agreement, a report, a payment file).
- Leave the rest as "-". Don't invent artefacts to fill the column.
- A step's **input is usually what its predecessor produced** — read the edges, not
  just the step, when deciding what flows in.

### 6a. The write-up goes stale — regenerate it FROM the map
The map is quick to edit; the per-step description / input / output / duration are
not, so after a few changes the table describes an older version of the process
than the picture does. That drift is silent and nobody notices until someone reads
the table. **Treat the map as the source of truth and regenerate the fields from
it** (the *✦ Fill details* button), rather than hand-patching them step by step.

Two rules for anything that regenerates them:
- **Never touch structure.** Text fields only — no new or deleted steps, no
  re-wiring, re-numbering, lane or label changes. Fixing prose must not quietly
  redesign the process.
- **Never silently overwrite what a human wrote.** Default to filling only the
  blanks, and make replacing existing text an explicit, separate choice. Hand-
  written detail is usually the most valuable text in the table.

## 6b. The house reference — INFRA People & Culture Procedure Manual
`~/Downloads/20250911_INFRA TOM_Procedure Manual _People and Culture_vF.pdf`
(process maps on pp. 17, 23, 30, 36…). This is what a finished map is *supposed*
to look like. What it does, and what we take from it:

- **Shapes are small relative to their lane — whitespace is the point.** A
  decision diamond is roughly a third to a half of the lane height, an activity
  box about half. A Review → Endorse → Endorse → Approve tower stacked across
  adjacent lanes has clear air between every diamond, so each reads as its own
  step. *Never let a shape fill its lane.* We shipped the opposite — a 100px
  diamond in a 104px lane, 2px of clearance — and stacked approvals touched
  vertex-to-vertex and looked like one merged blob. Fixed by `LANE_H = 132` with a
  76px diamond (56px of air between stacked decisions).
- **One lane carries the main chain — the bottom one**, owned by the doing team
  (`HR Strategy & Org Design team`, `Talent Acquisition & Development Team`).
  Start and End sit in that same lane. Approvals rise *out* of it and return to
  it. This is the reference's own confirmation of §1a/§1b.
- **The step code is printed OUTSIDE the shape**, small and grey, below-left
  (`HR-001-001-004`). It never competes with the label for room inside the box —
  which is also what lets the shapes stay small. *(We currently render the code
  inside the shape; the reference's placement is the better convention.)*
- **Lines are expansive too — they turn in the CHANNEL, not against the box.** An
  approval that flows back down to the next activity goes right, drops through the
  **empty column between two columns of shapes**, then enters the next step.
  Branch lines out of a decision run a long way before they split, so the Yes/No
  labels sit in open space. The reference never turns a corner hard against a
  shape and never routes along a lane edge or past the side of a box.
  Implementation: elbows sit at the **midpoint of the gap** between the two shapes
  (`routePoints` in [src/lib/exportSvg.js](src/lib/exportSvg.js), `offset: 40` on
  the canvas's `getSmoothStepPath`). Corners crowded 16px off the box before this,
  which also made parallel edges converge into a bundle. **Canvas and export must
  use the same rule** — they had drifted apart, the export hugging the target
  while the canvas centred its elbow.
- **Documents hang below the band.** Data objects sit under the activity that
  produces them, outside the lane rows, joined by a short line — they never
  consume a lane or a column slot in the flow.
- **Referenced processes** are plain labelled boxes placed next to the step that
  hands over to them (`OD & Workforce Planning`, `Payroll Management`).
- Numbering is hierarchical and zero-padded (`HR-001-003-018`) — prefix identifies
  the process, so codes stay unique across the manual.

## 7. Layout / readability — FILL VERTICALLY FIRST
- **A decision's branch targets that share a lane STACK in one column, growing the
  lane — they do not spread across columns.** When "Convert to full-time?" ends the
  process on "No" and hands to a referenced process on "Yes", and both End and the
  reference sit in the same owner's lane, the readable default is: End on the lane's
  top row, the reference on a second row directly below it, the lane expanded to two
  rows (`laneRows[lane] = 2`). Spreading them into two side-by-side columns instead
  wastes width and reads as cramped. A generated board therefore is NOT always one
  row per lane: `specToBoard` grows `laneRows` to fit each stack, and the stacking
  itself must survive column packing (co-lane siblings of a branch share a column,
  different rows). *(Render side implemented; the packing rule that keeps co-lane
  branch siblings in one column is the piece to finish.)*
- **Every shape is CENTRED on its lane, so connectors run dead straight.** A step
  and its neighbour are joined by a horizontal line at the lane's centre line; if
  one shape sits even a few pixels off-centre, that line acquires a pointless
  little jog on its way in. Shapes of different heights (a 76px diamond next to a
  94px +System box) still align because each is placed at
  `laneCenterY - height / 2` — centred, never top- or bottom-aligned.
  - The trap: a node stores its own `style.width/height`, which is a **copy** of
    the shape default taken when the node was created, and that copy is what gets
    rendered. Change a default without re-syncing the copies and the two disagree
    silently — decisions kept rendering at their old 100px height inside the new
    132px lane, landing 12px low, and every arrow into a decision kinked. Treat
    [src/shapes.js](src/shapes.js) as the single source of truth and re-sync
    `style` in the geometry migration.
  - A stale **width** is the same bug on the other axis: the node's rendered
    centre drifts off the column centre, and the otherwise-straight vertical
    connector picks up a tiny jog that reads on screen as a *doubled line*.
    Snap back to the column, never preserve the error.
  - Persist the geometry version the loaded data **was migrated to**, not the
    current constant — otherwise a hot reload stamps un-migrated boards as
    up-to-date and the next load skips the migration entirely.
  - **Repair by checking the data, not the version stamp.** A marker only records
    what you *believe* happened; once a board has been wrongly marked "migrated"
    it is stranded forever, because the marker itself is what suppresses the fix.
    Verify the invariants on every load instead — style matches the shape
    defaults, centre sits on a lane centre and a column centre — and correct what
    doesn't. Cheap, idempotent, and it heals boards no version bump can reach.
    *(Both halves of this were learned the hard way in one session: the stamp bug
    stranded the very boards the fix was written for.)*
- **Shapes must never fill their lane (§6b).** Leave real whitespace above and
  below every shape, or steps stacked in adjacent lanes merge into one blob and
  the connector between them disappears. Geometry lives in
  [src/board.js](src/board.js) (`LANE_H`) and [src/shapes.js](src/shapes.js)
  (per-shape sizes) — **they must be changed together**, and node positions are
  absolute pixels, so a geometry change needs a store migration (`GEOM_V` /
  `migrateGeometry` in [src/App.jsx](src/App.jsx)) or every saved board lands in
  the wrong lanes.
- **Before tuning anything here, get the lane ORDER right (§1a).** It is the
  biggest lever on how compact the map can be: the packing rules below can only
  work with the lane order you hand them. Initiator at the bottom; owners who act
  at the same stage in adjacent lanes; as few columns as possible without overlaps.
- The one rule (the user's own words): **"if there's space above/below, use it;
  only open a new column when there isn't."** Walk the steps in flow order and
  place each in the *current* column if that column still has a free slot in the
  step's lane (stack it above/below the others); only when the lane slot is
  already taken do you start a new column. This packs the board compactly instead
  of drifting one step to the right each time.
- Consequences that fall out of the rule automatically (no special-casing):
  - A **multi-party sign-off / signature** stacks into one column (IFM+CSI+Faculty
    approvals; IFM+Student+CSI signatures) — each is a different lane, all free.
  - A **review detour** (Submit → Review → Check → Final approval) stacks, because
    each reviewer is a different free lane in the same column.
  - A long run of **distinct roles in a stage** (collect stipend → source funds →
    run internship) also stacks — that's the compact look the user asked for.
  - The column only advances when a lane **repeats** (two steps owned by the same
    role can't share a column) or the column is full.
- **A connector must never overlap a box — and the check is BIDIRECTIONAL.** An
  edge and a box collide in two ways, and *both* must be prevented:
  1. **New edge over an existing box** — when a step stacks onto a predecessor,
     the vertical connector must reach the new lane through *empty* lanes; if an
     occupied lane sits between them, open a new column.
  2. **New box under an existing edge** — a long cross-lane edge already drawn in
     a column **reserves every lane it spans**; a later step may not be placed in
     any of those in-between lanes, or the earlier edge would run through it.
  Checking only (1) is the classic bug: a long top-to-bottom edge is drawn while
  the column is empty (looks fine), then later steps quietly fill the lanes
  *beneath* it and get buried. This is why an approval tower (monotonic — each hop
  goes further up/down over empty lanes) stacks cleanly, but a **non-monotonic**
  run (e.g. sign HoO→Student→CSI, top→bottom→middle) can't all share one column:
  the HoO→Student edge reserves the middle, so CSI (and anything after) spills to
  the next column. That's correct — cramming non-monotonic steps into one column
  always produces crossing edges. *(Learned twice on the Target intern process:
  first IHP-04→IHP-05 jumped the lane height (bug 1); then IHP-07..IHP-11 crammed
  into one column because later steps sat under the IHP-07→IHP-08 edge (bug 2).)*
  If you want a set of non-monotonic steps visually grouped anyway, either order
  them monotonically by lane (when the sequence is flexible, e.g. independent
  signatures) or group them by hand with marquee-select + shift-column.
- **The same two checks apply HORIZONTALLY, and forgetting that is the other
  classic bug.** A step flowing to another step in the *same lane* draws a
  straight horizontal line along that lane, so:
  3. **New edge through an existing box** — a same-lane connector must not span a
     column that is already occupied in that lane.
  4. **New box on an existing edge** — a horizontal edge already drawn in a lane
     reserves every column it spans; a later step may not land in one of them.
  Checks 1–2 (vertical) alone will happily report a "clean" board whose long
  horizontal arrows run straight through boxes — which is exactly what happened:
  a checker that only looked at vertical crossings reported *17 crossings → 0*
  while the map visibly had arrows passing behind shapes. **Any layout check must
  test both axes**, or it certifies the bug it was written to catch.
- **Where placement can't win, the two cases and what to do:**
  - *A step from another branch already sits between a step and its successor.*
    Moving the successor further right only lengthens the line over it — move the
    **blocker** clear of the edge instead. Cap this at one relocation per step: an
    uncapped repair loop let two branches shove each other out to **column 123**.
  - *A decision whose two branches both belong to the decision's own lane.* No
    column assignment can fix this — whichever branch is nearer, the other
    branch's arrow passes over it. This one is solved by **routing**, not layout:
    the edge steps out to the lane boundary, travels past the obstruction, and
    comes back in. Don't burn effort trying to pack it away.
- **Every step must be reachable — no dangling steps.** A step with no incoming
  connection has nothing to sit to the right of, so its base column is 0 and it
  drifts to the far left of the board, nowhere near the step it feeds. It also
  gets numbered late (the chain walk only reaches it after the main flow runs
  out). Both symptoms — *"why is IHP-12 at the far left instead of under
  IHP-11?"* — come from one missing edge. When generating, **connect the whole
  flow end to end**; when a step genuinely has no predecessor yet, say so with
  `OPEN:` rather than leaving it silently unwired. The layout now pulls such a
  step next to its earliest successor, but that is damage control, not a fix —
  the edge is still missing and the numbering will still be off.
- Implemented in `specToBoard` and `tidyColumns` ([src/lib/layout.js](src/lib/layout.js)),
  which share one `packColumns` (so first render and re-tidy can never drift) over
  one `flowOrder` chain walk. `connectorCrosses`/`underExistingEdge` = checks 1-2,
  `rowCrosses`/`insideExistingRowEdge` = checks 3-4, then a bounded repair pass and
  the orphan pull. Invariants are asserted by `checkLayout`
  ([src/lib/layout.check.js](src/lib/layout.check.js)) — **both axes**. A node may
  still carry an explicit `col` to override placement, but samples don't need it —
  flow order + these rules give the compact layout by default. Manual tuning:
  **Select** mode (marquee-drag) + **←col / col→** shift a selected block.
- **"Tidy & number" re-packs, it does not re-think.** It keeps the lane you dragged
  each shape into (lane = owner, your call) and recomputes every column from the
  flow, then renumbers. It will never invent, delete or rewire an edge. So a map
  that looks wrong *because a connection is wrong* will look exactly as wrong
  after tidying — fix the edge, then tidy.
- Keep spacing roomy so shapes aren't crowded; use **Tidy layout** to re-space.
- Table cells auto-grow — never truncate descriptions; write the full text.

## 8. Capture open questions in-cell
- If the source leaves something undecided (who signs, which system, an SLA, an
  optional branch), write it into the step's description prefixed `OPEN:` rather
  than dropping it. It keeps the map faithful to the discussion.

## 9. Sessions
- Loading an example opens it as its **own new process session** — it never
  overwrites the process you are currently editing.

## 9b. PROCESS BRACKETS (phases) — the story over the detail
A map of 20+ steps is unreadable as a story. Group it into **4-6 stages** so the
process can be told as "① … → ② … → ③ …" without reading a single step.

**A phase is contiguous in FLOW ORDER, not in space.** This is the whole design
constraint, and it is easy to get wrong: on a swim-lane map consecutive steps stack
*vertically inside one column*, so the last step of a stack routinely belongs to the
next stage. A phase therefore cannot be drawn as a rectangle over the map without
cutting a column in half — we tried, and the brackets overlapped (phase 1 spanned
columns 0-1, phase 2 column 1, phase 3 columns 1-2). Phases live in their own view,
as a chain of stages, not as geometry on the board.

Rules:
- **4-6 stages.** Fewer says nothing; more is not a summary.
- **Sequential and contiguous**: every step of stage 2 comes after every step of
  stage 1. Never interleave.
- **Cut where the process changes gear** — a new artefact appears, the work hands
  over to a different group, or a distinct outcome is reached.
- **Start and End belong to no stage.** They are punctuation, not work; including
  them inflates the step counts and says nothing.
- **Alternative endings get their OWN stage**, not a fold into a main-path one
  (extended / converted / rejected are alternatives, not successors). Colour-code
  them so the chain reads as "main path + scenarios" rather than a straight line.
- A stage spanning several owners is normal and expected — that is what a stage IS.
  It names the owners it involves rather than pretending to sit in one lane.

### Naming a stage — ACTION-NOUNS, not verbs and not states
Use the gerund form, which is what the People & Culture manual uses for its own
processes: **Job Posting**, **Candidate Interviewing**, **Compensation Management**.

So: `Contract signing` · `Stipend processing` · `Internship close-out` ·
`Request identification & endorsement`.

- ❌ **Imperative verbs** — "Sign the contract". That is how STEPS are written, so a
  stage named this way reads as the same level as its own contents and the
  hierarchy disappears.
- ❌ **Bare outcome states** — "Signed contract". Names what is left behind rather
  than the work the stage contains, and drifts into passive participles.
- ❌ "Phase 2", "Approval steps" — says nothing.

2-5 words, in the process's own vocabulary, and distinct from each other: if two
stages would take the same name, the difference between them is exactly what each
name has to capture.

**Names go stale when the grouping changes.** Dragging steps between stages leaves
every name describing the old membership, so re-derive them from what each stage NOW
holds — and keep that a separate action from re-grouping, so fixing a name can never
quietly redesign a grouping someone did by hand.

## 10. Gap analysis — every process gets one
After mapping a process, analyze its gaps against the guiding principles of a
good process and render them in an **analysis box under the board**.

Overarching goal: **as simple as possible, as automated as possible.** Then
interrogate the process from EACH of these seven angles (the user's own frame —
apply them to every future analysis) and report the ones that bite:

1. **Too many steps / approvals** — redundant or serial approval gates, sign-off
   by someone too senior for the risk, and separate steps that should be merged
   (e.g. a "request" and a "contract" step that are really one).
2. **Too much manual effort** — checking, filling, signing, emailing by hand and
   re-keying the same data; call out work that doesn't actually need a person.
3. **No system of record** — runs on email, no e-signature, or dead-ends so the
   subject/output is never recorded anywhere.
4. **Owners are people, not roles** — steps owned by named individuals instead of
   roles; and stakeholders/departments (e.g. academic supervisor, finance,
   faculty, visa) never formally consulted or informed.
5. **Missing steps** — completeness gaps a domain expert expects: a calculation
   or funding split, a required approval, a compliance/eligibility check.
6. **No clock, no measure** — no SLA / duration on steps, no KPIs.
7. **No exceptions or close-out** — no path for extensions, conversions or
   rejections; no onboarding, hand-over or evaluation after the last step.

### The shape of a finding — DIAGNOSIS first, evidence second
Each line is one **theme**, written as:

> `Short verdict — the evidence for it across the whole process.`

The verdict is a judgement about a *pattern* ("Too much manual effort", "No
system", "Owners are people, not roles"). The evidence then **aggregates the whole
map into one sentence** — it does not walk through the steps one at a time.

**One line per angle. 5–8 lines total. No numbered headings, no sub-bullets.**
**Each line is at most ~30 words** — past that you are narrating the map instead of
judging it. **No two lines may make the same point**: if two findings both amount to
"there is a lot of manual work", they are one line, and the space goes to an angle
not yet covered. **The subject of the sentence is always a pattern, never a step** —
"The contract step is broken" is wrong even when true; name the pattern it
illustrates and let the step be a parenthetical example.

The failure mode to design against is **granularity**: the analysis reads like a
list of step-level observations, each technically true, none of them telling the
reader what is actually wrong. If a line names a step code, ask whether the point
is really about that step or about a pattern the step merely illustrates — it is
almost always the pattern. Step codes appear at most as a parenthetical example,
never as the subject of the sentence.

❌ **Too granular** (what a naive analysis produces — every line a separate
step-level finding, the reader still has no verdict):
```
- Redundant approval chain: three sequential IFM→CSI→Faculty approvals (IPN-02 to
  IPN-04) for an IFM-internal internship cause delays without clear role separation.
- Finance hand-off disconnected: CSI collects stipend data (IPN-10) but Student
  Finance (IPN-11) has no named system connection, implying manual re-keying.
- Missing rejection paths: IPN-02, IPN-14 and IPN-15 have no "No" branch.
- No SLA or duration: every approval and notification step lacks a clock.
```

✅ **Right** — the standard to hit (a real analysis of the as-is intern process).
Note how each line indicts a pattern, then proves it by summarising the whole map,
and how blunt the verdicts are:
```
Some steps with unclear intentions — some steps have no clear outcome (e.g. CSI checks details, then what?).
Too much manual effort — documents checked by hand, contracts filled, signed and emailed manually, data re-keyed at every step. Almost none of it needs a person.
No system — it runs on email, has no e-signature, and dead-ends at payment, so the intern is never recorded anywhere.
Owners are people, not roles — and the departments involved (academic supervisor, Student Finance, faculty, visa) are never formally consulted or informed.
Missing steps — no academic-supervisor approval, no visa check for overseas interns.
No clock, no measure — no SLA on any step, no KPIs.
No exceptions or close-out — nothing for extensions, conversions or rejections, and no onboarding or evaluation after payment.
```

Wording rules:
- Plain, direct language. "Almost none of it needs a person" beats "significant
  automation potential exists".
- Say what is wrong. A finding that could be pasted into any process map
  ("no SLA defined") is only worth a line if it is *true here and matters here* —
  and then it still gets this process's specifics attached to it.
- Report only the angles that bite. Six real findings beat eight padded ones.
- No separate recommendations section; where the fix is obvious it rides along in
  the same sentence.

In the app: the **✦ Analyze gaps** toolbar button (map view) runs this with AI on
the current process; **✎ Edit gaps** opens the box as free text; ✕ Analysis
removes it.

---

### Worked example — Intern Process (New), step IPN-02…IPN-04
Source email: *"Opportunity gets approved — requires sign-off from all three
parties (Careers Team, Faculty Advisor, IFM)."* Per §3 this becomes three
sequenced approvals, one in each approver's lane:

| # | Step | Owner (lane) |
|------|------|------|
| IPN-02 | Approve opportunity | Careers Team (CSI) |
| IPN-03 | Approve opportunity | Faculty Advisor / Supervisor |
| IPN-04 | Approve opportunity | IFM |

— not a single "Opportunity approved by CSI, Faculty & IFM?" diamond.

---

### Worked example — a whole brain-dump → the Target intern map
This is the reference for §0. **Left = what the stakeholder wrote. Right = what
went on the map, and why.**

| Raw dump line | On the map | Why |
|---|---|---|
| `IFM - Technical Team: identify hiring requests` | **IHP-01 Identify hiring request** (Technical Team lane) | actor → lane, action → step |
| `IFM - Technical head: review and endorse` | **IHP-02 Endorse hiring request** — *decision diamond* | "endorse" ⇒ decision shape (§5a); reject branch omitted for cleanness (§5b) |
| `fill in the requested info with students and faculty advisor (… NOC letter from the academic supervisor) — should already be in the system` | **IHP-03 Complete internship request in system** *(+System: Symplicity)* | the "already in the system" hint ⇒ +System shape naming the system |
| `Student: submit the required information (is it going to be a process step?)` | **IHP-04 Add student details & documents (incl. NOC)** (Student lane) | **question answered:** yes — but a light form, not an approval. The advisor's **NOC became a document the student uploads**, so no Faculty-Advisor lane |
| `Head of Operations/HR: endorse required details (Is human effort really required here?)` | **IHP-05 Auto-validate request (budget, policy, completeness)** — *Automated "A"* | **question answered: no.** Automate the check; HR reviews **exceptions only** |
| `System: auto-generate contract and send to parties' mailboxes` | **IHP-06 Auto-generate contract & route to signatories** — *Automated "A"*, CSI lane | "System" is **not** a lane — it's the automated shape in the owning lane |
| `Head of Operations - IFM / Student / CSI: sign the contracts` | **IHP-07 / 08 / 09 Sign contract —** HoO, Student, CSI | one signing step **per signatory**, each in its own lane (§3a) |
| `Student Finance: apply calculations on the stipend` | **IHP-10 Apply stipend calculations** | direct |
| `University Finance: register salary (are systems connected?)` | **IHP-11 Register salary in University Finance** — *Automated "A"* + `OPEN:` note | **question answered conditionally:** model it automated, flag the integration risk; it also becomes a gap-analysis bullet |
| `scenario 1 / 2 / 3` (ends on time / extends / converts) | `Extend internship?` → (Endorse → Approve) → **one** `Off-board & complete evaluation` → `Convert to full-time?` → *Full-time hiring process* (Referenced Process) or End | **three scenarios, no duplicated steps** — shared work factored out, variants as sequential decisions (§0.5) |

The unanswered questions didn't disappear — they became the **gap-analysis box**
(approvals really needed? which system is the source of truth? is CSI's signature
required? are Student and University Finance the same team?). That box is the
deliverable that drives the follow-up conversation.
