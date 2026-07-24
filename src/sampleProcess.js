// Ready-made processes (no API key needed). Same shape the AI would return, so
// each flows through specToBoard → both the map and the table.

const A = (id, lane, label, numbering, description, input = '-', output = '-', duration = '-') =>
  ({ id, type: 'activity', lane, label, numbering, description, input, output, duration })
const D = (id, lane, label, numbering, description, input = '-', output = '-', duration = '-') =>
  ({ id, type: 'decision', lane, label, numbering, description, input, output, duration })
const link = (pairs) => pairs.map(([source, target, label]) => ({ source, target, ...(label ? { label } : {}) }))

// ── Intern Process (Current) — kept manual, as it is done today ──────────────
export const INTERN_PROCESS = {
  title: 'Intern Process (Current)',
  lanes: [
    { id: 'l_richard', label: 'Richard — Head' },
    { id: 'l_brenda', label: 'Brenda Ward' },
    { id: 'l_hector', label: 'Hector — Abu Dhabi' },
    { id: 'l_ifm', label: 'IFM Hiring Team' },
    { id: 'l_student', label: 'Student' },
    { id: 'l_finance', label: 'Finance Business Partner' },
  ],
  nodes: [
    { id: 'n_start', type: 'startEnd', lane: 'l_ifm', label: 'Start' },
    A('a01', 'l_ifm', 'Submit hiring request', 'INT-01',
      'Identify the intern candidate and submit the hiring request through the e-Services form (or by email).',
      '-', 'Hiring request', '1 day'),
    A('a02', 'l_hector', 'First review & approval', 'INT-02',
      'First review and approval of the hiring request in Abu Dhabi (e-Services workflow / email).',
      'Hiring request', 'First approval', '1–2 days'),
    A('a03', 'l_brenda', 'Check documents & details', 'INT-03',
      'Manually review that the candidate documents and request details are complete and correct.',
      '-', 'Verified request', '1 day'),
    A('a04', 'l_richard', 'Final approval to proceed', 'INT-04',
      'Final approval to proceed with the intern hire (e-Services workflow / email).',
      'Verified request', 'Final approval', '1–2 days'),
    A('a05', 'l_ifm', 'Fill contract template', 'INT-05',
      'Manually fill the location-specific contract template (Word) with the student’s details.',
      'Final approval', 'Draft contract', '0.5 day'),
    A('a06', 'l_richard', 'Sign contract (employer side)', 'INT-06',
      'Employer-side signature of the intern contract.',
      'Draft contract', 'Employer-signed contract', '1 day'),
    A('a07', 'l_ifm', 'Send contract to student', 'INT-07',
      'Manually email the employer-signed contract to the student to sign.',
      '-', 'Contract issued', '0.5 day'),
    A('a08', 'l_student', 'Student signs contract', 'INT-08',
      'The student reviews and signs the contract.',
      '-', 'Fully signed contract', '1–3 days'),
    A('a09', 'l_finance', 'Process stipend payment', 'INT-09',
      'Manually set up and process the intern’s stipend payment. (Note: Brenda suggests moving this to Student Finance.)',
      'Fully signed contract', 'Stipend scheduled', '2–5 days'),
    { id: 'n_end', type: 'startEnd', lane: 'l_finance', label: 'End' },
  ],
  edges: link([
    ['n_start', 'a01'], ['a01', 'a02'], ['a02', 'a03'], ['a03', 'a04'], ['a04', 'a05'],
    ['a05', 'a06'], ['a06', 'a07'], ['a07', 'a08'], ['a08', 'a09'], ['a09', 'n_end'],
  ]),
  analysis: [
    { summary: 'Too many approvals', explanation: 'Two review-and-approval gates plus a final sign-off by someone too senior (Richard), and separate "request" and "contract" steps that should be one.' },
    { summary: 'Almost all manual', explanation: 'Documents are checked, contracts filled, signed and emailed by hand with data re-keyed at every step — almost none of it needs a person.' },
    { summary: 'No system of record', explanation: 'It runs on email, has no e-signature, and dead-ends at payment, so the intern is never recorded anywhere.' },
    { summary: 'Owners are people, not roles', explanation: 'Steps belong to individuals, and the departments involved (academic supervisor, Student Finance, faculty, visa) are never formally consulted or informed.' },
    { summary: 'Missing steps', explanation: 'No stipend calculation / funding split, no academic-supervisor approval, and no visa check for overseas interns.' },
    { summary: 'No clock, no measure', explanation: 'No step has an SLA and there are no KPIs, so delays and performance stay invisible.' },
    { summary: 'No exceptions or close-out', explanation: 'Nothing handles extensions, conversions or rejections, and there is no onboarding or evaluation after payment.' },
  ],
}

// ── Intern Process (New) — proposed flow from the CSI email (Symplicity) ──────
export const INTERN_PROCESS_NEW = {
  title: 'Intern Process (New — proposed)',
  lanes: [
    { id: 'faculty', label: 'Faculty Advisor / Supervisor' },
    { id: 'csi', label: 'Careers Team (CSI)' },
    { id: 'finance', label: 'Student Finance' },
    { id: 'ifm', label: 'IFM' },
    { id: 'student', label: 'Student' },
  ],
  // No explicit columns — the layout packs vertically by default (fill a free
  // lane slot in the current column before opening a new one). Flow order alone
  // gives the compact swim-lane layout.
  nodes: [
    { id: 's', type: 'startEnd', lane: 'student', label: 'Start' },
    A('p01', 'student', 'Add internship to Careers Portal', 'IPN-01',
      'Student adds the internship opportunity with IFM to the MBZUAI Student Careers Portal (Symplicity). (Alt. start: IFM posts the internship on the portal — both start scenarios consolidate here.)',
      '-', 'Portal opportunity record', '1 day'),
    // Opportunity sign-off runs in the real order IFM → CSI → Faculty Advisor,
    // one approval step per approver, all stacked in the approval column.
    D('ap_ifm', 'ifm', 'Approve opportunity', 'IPN-02',
      'IFM reviews the opportunity and signs off first. OPEN: confirm who from IFM approves (technical lead?) and which system is used.',
      'Portal opportunity record', '-', '1–2 days'),
    D('ap_csi', 'csi', 'Approve opportunity', 'IPN-03',
      'Careers Team (CSI) reviews the opportunity and signs off. CSI reaches out to the faculty advisor / Prof Dezhen for longer or second internships.',
      '-', '-', '1–2 days'),
    D('ap_fac', 'faculty', 'Approve opportunity', 'IPN-04',
      'Faculty Advisor reviews the opportunity and signs off last.',
      '-', 'Approved opportunity', '1–2 days'),
    A('desc', 'ifm', 'Add internship description & learning outcomes', 'IPN-05',
      'IFM / company supervisor reviews the portal record and adds the internship project description and how learning outcomes will be met (industry-partner guidelines apply).',
      '-', 'Internship description', '1–2 days'),
    { id: 'agree', type: 'automatedActivity', lane: 'csi', label: 'Draft tripartite agreement', numbering: 'IPN-06',
      description: 'Tripartite agreement is generated automatically from the Careers Portal, populated from the internship record, and is viewable by all three parties.',
      input: 'Internship description', output: 'Tripartite agreement (draft)', duration: '0.5 day' },
    // The tripartite agreement has 3 signatories — IFM (Internship Supervisor),
    // the Student and CSI (University / Careers) — one signing step each, with a
    // maximum SLA for the whole set.
    A('sign_ifm', 'ifm', 'Sign agreement — IFM (Supervisor)', 'IPN-07',
      'The Internship Supervisor at IFM signs the tripartite agreement.',
      'Tripartite agreement (draft)', '-', '1–3 days'),
    A('sign_stu', 'student', 'Sign agreement — Student', 'IPN-08',
      'The student signs the tripartite agreement.',
      '-', '-', '1–3 days'),
    A('sign_csi', 'csi', 'Sign agreement — CSI (University)', 'IPN-09',
      'CSI countersigns on behalf of the University; the fully-signed agreement is stored on the portal. Set a maximum SLA for signature.',
      '-', 'Signed agreement', '1–3 days'),
    A('stip', 'csi', 'Collect stipend information', 'IPN-10',
      'Collect internship stipend details, e.g. the split between IFM and faculty budgets.',
      '-', 'Stipend details', '1–2 days'),
    A('funds', 'finance', 'Apply calculations & source funds', 'IPN-11',
      'Apply calculations and ensure funds are drawn from the correct buckets (IFM project budget or divisional budget).',
      'Stipend details', '-', '2–3 days'),
    A('run', 'student', 'Run internship; track hours & tasks weekly', 'IPN-12',
      'Internship starts; the student tracks hours and tasks weekly.'),
    A('visit', 'csi', 'Conduct mid-internship field visit', 'IPN-13',
      'Careers Team conducts a mid-internship field visit.'),
    A('report', 'student', 'Submit report & deliver presentation', 'IPN-14',
      'Student submits a report and delivers a presentation as an evaluation / reflection of the internship.',
      '-', 'Report + presentation'),
    A('mark', 'faculty', 'Mark internship satisfactory / unsatisfactory', 'IPN-15',
      'Faculty Supervisor marks the internship satisfactory or unsatisfactory.',
      'Report + presentation', 'Outcome'),
    A('eval', 'ifm', 'Complete end-of-internship evaluation on portal', 'IPN-16',
      'End-of-internship evaluation on the Careers Portal. Optionality: if extended or a return offer is made, inform CSI; the final evaluation can be completed after the mandatory component (6 weeks MSc / 3 months PhD).'),
    { id: 'e', type: 'startEnd', lane: 'ifm', label: 'End' },
  ],
  edges: link([
    ['s', 'p01'], ['p01', 'ap_ifm'], ['ap_ifm', 'ap_csi'], ['ap_csi', 'ap_fac'], ['ap_fac', 'desc'],
    ['desc', 'agree'], ['agree', 'sign_ifm'], ['sign_ifm', 'sign_stu'], ['sign_stu', 'sign_csi'], ['sign_csi', 'stip'],
    ['stip', 'funds'], ['funds', 'run'], ['run', 'visit'], ['visit', 'report'], ['report', 'mark'],
    ['mark', 'eval'], ['eval', 'e'],
  ]),
  // Open questions to resolve with CSI / Finance before finalising the proposal.
  analysis: [
    '1. Approvals',
    "- IFM internships aren't industry placements, so do we need CSI and faculty-advisor approval at all, and what value does each add? Can it collapse to a single approver within IFM?",
    '2. System of record',
    '- Is Symplicity the one true system, or e-services, for the internship process?',
    '- Can IFM have an account to work inside it?',
    '- We\'d want CSI to walk us through what the portal actually does end to end, and why the student adds the opportunity rather than IFM.',
    '3. Signatures',
    "- Since IFM is an internal school entity, is CSI's signature really needed, or is two-party sufficient (IFM and student)?",
    '- If everything is in the system, should CSI be informed of anything else?',
    '4. Stipend & finance',
    '- Is the intern salary processing request handled in a system or by hand?',
    '- Are Student Finance and University Finance the same team?',
    '- Is the Symplicity system connected to the Finance system?',
  ],
}

// ── Intern Process (Target design) — IFM's clean-slate target state ──────────
export const INTERN_PROCESS_TARGET = {
  title: 'Intern Process (Target design)',
  lanes: [
    { id: 'hr', label: 'Head of Operations / HR' },
    { id: 'thead', label: 'IFM — Technical Head' },
    { id: 'csi', label: 'CSI (Careers)' },
    { id: 'ufin', label: 'University Finance' },
    { id: 'sfin', label: 'Student Finance' },
    { id: 'team', label: 'IFM — Technical Team' },
    { id: 'student', label: 'Student' },
  ],
  nodes: [
    { id: 's', type: 'startEnd', lane: 'team', label: 'Start' },
    A('t01', 'team', 'Identify hiring request', 'IHP-01',
      'IFM Technical Team identifies the intern hiring need and raises the request.',
      '-', 'Hiring request', '1 day'),
    A('t02', 'thead', 'Endorse hiring request', 'IHP-02',
      'Technical Head reviews and endorses the need before any detail work begins. (Not-endorsed is omitted for cleanness — see gap analysis.)',
      'Hiring request', '-', '1 day'),
    A('t03', 'team', 'Complete internship request in system', 'IHP-03',
      'Fill the Symplicity / e-Services template — role, description, learning objectives and salary. The student then attaches their own materials below.',
      '-', 'Completed request'),
    A('t04', 'student', 'Add student details & documents (incl. NOC)', 'IHP-04',
      'Student completes their required fields and uploads the required documents — including the NOC letter they obtain from their academic supervisor — via the portal. The advisor is not a separate workflow step.',
      '-', 'Documents + NOC'),
    { id: 't06', type: 'automatedActivity', lane: 'hr', label: 'Auto-validate request (budget, policy, completeness)', numbering: 'IHP-05',
      description: 'System checks headcount/budget, policy and completeness (including that the NOC is attached); HR reviews only flagged exceptions instead of endorsing every request.',
      input: 'Completed request', output: 'Validated request', duration: '-' },
    { id: 't07', type: 'automatedActivity', lane: 'csi', label: 'Auto-generate contract & route to signatories', numbering: 'IHP-06',
      description: 'System generates the contract and sends it to the IFM Head of Operations, the Student and CSI mailboxes for e-signature.',
      input: 'Validated request', output: 'Draft contract', duration: '-' },
    A('t08', 'hr', 'Sign contract — Head of Operations', 'IHP-07',
      'IFM Head of Operations e-signs the contract.'),
    A('t09', 'student', 'Sign contract — Student', 'IHP-08',
      'Student e-signs the contract.'),
    A('t10', 'csi', 'Sign contract — CSI', 'IHP-09',
      'CSI countersigns; the fully-signed contract is stored on the portal.',
      '-', 'Signed contract'),
    A('t11', 'sfin', 'Apply stipend calculations', 'IHP-10',
      'Salary is already in the system; Student Finance applies the stipend calculation and funding split.',
      'Signed contract', 'Stipend set'),
    { id: 't12', type: 'automatedActivity', lane: 'ufin', label: 'Register salary in University Finance', numbering: 'IHP-11',
      description: 'Salary details register in the University Finance system. OPEN: needs a Symplicity ↔ Finance integration — without it the figures are re-keyed by hand.',
      input: 'Stipend set', output: '-', duration: '-' },
    A('t13', 'student', 'Run internship; track hours & tasks weekly', 'IHP-12',
      'Internship runs; the student logs hours and tasks weekly.'),
    // Two sequential decisions express the three end scenarios cleanly:
    //   on-time  = Extend?No  → Convert?No
    //   extend   = Extend?Yes → (endorse → approve) → conclude
    //   convert  = Convert?Yes → full-time process
    // "Submit extension" is folded into the Extend? decision so the extension's
    // first drawn step sits in the Tech-Head lane, not the Team lane — that keeps
    // the "No" branch adjacent to off-boarding (no arrow crosses another box).
    D('t14', 'team', 'Extend internship?', 'IHP-13',
      'At the end of the term the team decides whether to request an extension (with reasons and justifications — submitting the request is part of this step).'),
    A('t16', 'thead', 'Endorse extension', 'IHP-14',
      'Technical Head endorses the extension request.'),
    A('t17', 'hr', 'Approve extension; inform CSI & Finance', 'IHP-15',
      'HR approves the extension; CSI and Finance are informed. The internship then continues to its new end date.'),
    A('t18', 'team', 'Off-board & complete evaluation', 'IHP-16',
      'Technical Team approves the off-boarding date and completes the end-of-internship evaluation.',
      '-', 'Evaluation'),
    D('t19', 'team', 'Convert to full-time?', 'IHP-17',
      'Decide whether the intern converts to a full-time hire.'),
    { id: 't20', type: 'referencedProcess', lane: 'hr', label: 'Full-time hiring process', numbering: 'IHP-18',
      description: 'Hand off to the separate full-time hiring process.' },
    { id: 'e', type: 'startEnd', lane: 'team', label: 'End' },
  ],
  edges: link([
    ['s', 't01'], ['t01', 't02'], ['t02', 't03'],
    ['t03', 't04'], ['t04', 't06'], ['t06', 't07'], ['t07', 't08'],
    ['t08', 't09'], ['t09', 't10'], ['t10', 't11'], ['t11', 't12'], ['t12', 't13'], ['t13', 't14'],
    ['t14', 't16', 'Yes'], ['t14', 't18', 'No'],
    ['t16', 't17'], ['t17', 't18'],
    ['t18', 't19'], ['t19', 't20', 'Yes'], ['t19', 'e', 'No'], ['t20', 'e'],
  ]),
  analysis: [
    { summary: 'Two approval layers remain', explanation: 'The technical-head endorsement and the auto-validation both gate a low-risk hire — consider one risk-based check instead of two.' },
    { summary: 'Signatures still serial', explanation: 'The three contract e-signatures (Head of Ops, Student, CSI) are chained; requesting them in parallel would cut the wait to the slowest signer.' },
    { summary: 'Finance integration assumed', explanation: 'Registering salary in University Finance relies on a Symplicity ↔ Finance link — if it does not exist the figures are re-keyed by hand.' },
    { summary: 'Seven owners per hire', explanation: 'The chain still crosses seven roles; University Finance touches it only once, so each hand-off is a place work can wait.' },
    { summary: 'No visa or onboarding step', explanation: 'Overseas interns have no work-eligibility / visa check, and nothing onboards the student between signing and day one.' },
    { summary: 'No SLA or KPI', explanation: 'No step carries a time target or measure, so the endorsement, signature and extension chains can still stall silently.' },
    { summary: 'No rejection paths (by choice)', explanation: 'The endorsements and auto-validation show only their forward path — reject / revise-and-resubmit is deliberately omitted for cleanness and still needs designing.' },
  ],
}

// ── HC Strategic Planning (HR-001-001), from the P&C Procedure Manual ─────────
export const HC_STRATEGIC_PLANNING = {
  title: 'HC Strategic Planning (HR-001-001)',
  lanes: [
    { id: 'nrc', label: 'Nomination & Remuneration Committee' },
    { id: 'ceo', label: 'Chief Executive Officer' },
    { id: 'mc', label: 'Management Committee' },
    { id: 'cos', label: 'Chief of Staff' },
    { id: 'pmo', label: 'Head of Strategy & PMO' },
    { id: 'chro', label: 'CHRO' },
    { id: 'head', label: 'Head of HR Strategy & Org Design' },
    { id: 'team', label: 'HR Strategy & Org Design Team' },
  ],
  nodes: [
    { id: 'start', type: 'startEnd', lane: 'team', label: 'Start' },
    A('a001', 'team', 'Develop / update HC strategic planning guidelines & tools', 'HR-001-001-001',
      'Benchmark best practices, identify gaps in the current approach, develop/update the guidelines, objectives and tools, and submit for review.',
      '-', 'HC Strategic Planning Guidelines & Tools'),
    D('a002', 'head', 'Review', 'HR-001-001-002', 'Review the guidelines and tools; share with CHRO and Chief of Staff for approval.'),
    D('a003', 'chro', 'Approve', 'HR-001-001-003', 'Review and approve the guidelines and tools.'),
    D('a004', 'cos', 'Approve', 'HR-001-001-004', 'Review and approve the guidelines and tools.'),
    A('a005', 'team', 'Conduct HC function assessment', 'HR-001-001-005',
      'Assess the current HC function against the guidelines to establish a baseline.', '-', 'Baseline Assessment Report'),
    A('a006', 'team', 'Analyze future HC capabilities & needs', 'HR-001-001-006',
      'Analyze future workforce capabilities and needs.', 'Baseline Assessment Report', 'Future HC Capabilities & Needs'),
    A('a007', 'team', 'Develop strategic pillars & direction', 'HR-001-001-007',
      'Run a SWOT analysis, form and validate hypotheses, and develop the strategic pillars and direction.',
      'Future HC Capabilities & Needs', 'Strategic Pillars'),
    D('a008', 'head', 'Review', 'HR-001-001-008', 'Review the strategic pillars; share with CHRO for endorsement.'),
    D('a009', 'chro', 'Endorse', 'HR-001-001-009', 'Review and endorse the strategic pillars; share with the CEO for approval.'),
    D('a010', 'ceo', 'Approve', 'HR-001-001-010', 'Review and approve the strategic pillars.'),
    A('a011', 'team', 'Develop HC strategic plan', 'HR-001-001-011',
      'Cascade the approved strategic objectives into a full HC strategic plan.', 'Strategic Pillars', 'HC Strategic Plan', '6 months'),
    D('a012', 'head', 'Review', 'HR-001-001-012', 'Review the HC strategic plan.'),
    D('a013', 'chro', 'Review', 'HR-001-001-013', 'Review the HC strategic plan.'),
    D('a014', 'pmo', 'Endorse', 'HR-001-001-014', 'Review and endorse the HC strategic plan.'),
    D('a015', 'cos', 'Endorse', 'HR-001-001-015', 'Review and endorse the HC strategic plan.'),
    D('a016', 'mc', 'Endorse', 'HR-001-001-016', 'Review and endorse the HC strategic plan; share with the Nomination & Remuneration Committee.'),
    D('a017', 'nrc', 'Approve', 'HR-001-001-017', 'Review and approve the HC strategic plan.'),
    A('a018', 'team', 'Communicate plan with concerned stakeholders', 'HR-001-001-018',
      'Gather reporting requirements, build a communication plan, and communicate with all concerned functions.'),
    A('a019', 'team', 'Implement HC strategic plan', 'HR-001-001-019',
      'Initiate implementation with stakeholders and monitor progress, adjusting as needed.'),
    { id: 'end', type: 'startEnd', lane: 'team', label: 'End' },
  ],
  edges: link([
    ['start', 'a001'], ['a001', 'a002'], ['a002', 'a003'], ['a003', 'a004'], ['a004', 'a005'],
    ['a005', 'a006'], ['a006', 'a007'], ['a007', 'a008'], ['a008', 'a009'], ['a009', 'a010'],
    ['a010', 'a011'], ['a011', 'a012'], ['a012', 'a013'], ['a013', 'a014'], ['a014', 'a015'],
    ['a015', 'a016'], ['a016', 'a017'], ['a017', 'a018'], ['a018', 'a019'], ['a019', 'end'],
  ]),
}

export const SAMPLES = [
  { name: 'Intern Process (Current)', spec: INTERN_PROCESS },
  { name: 'Intern Process (New)', spec: INTERN_PROCESS_NEW },
  { name: 'Intern Process (Target design)', spec: INTERN_PROCESS_TARGET },
  { name: 'HC Strategic Planning (manual)', spec: HC_STRATEGIC_PLANNING },
]

// Hand-curated gap analyses, keyed by process title. "Analyze gaps" prefers
// these over the AI / local analyzer, so a known process always shows the
// authored write-up even in a session that predates it (e.g. the user's own
// edited "Intern Process (Current)").
export const CURATED_ANALYSES = {
  ...Object.fromEntries(
    [INTERN_PROCESS, INTERN_PROCESS_NEW, INTERN_PROCESS_TARGET]
      .filter((p) => p.analysis?.length)
      .map((p) => [p.title.trim(), p.analysis]),
  ),
  // Title aliases so a session named any of these gets the proposed outline.
  'Intern Process (Proposed)': INTERN_PROCESS_NEW.analysis,
  'Intern Process (New)': INTERN_PROCESS_NEW.analysis,
  'Intern Process (New — Proposed)': INTERN_PROCESS_NEW.analysis,
}
