// Central catalogue of every process-map shape.
// `type` is used both as the React Flow node type and as the AI output enum.

export const SHAPES = [
  {
    type: 'startEnd',
    name: 'Start / End',
    hint: 'Event',
    desc: 'Start Event: the beginning of a process. End Event: the end of a process.',
    defaultData: { label: 'Start' },
    size: { width: 130, height: 54 },
  },
  {
    type: 'activity',
    name: 'Activity',
    hint: 'Step',
    desc: 'An activity within a process. A numbering code (e.g. PROC-001-003-007) can be added later.',
    defaultData: { label: 'Activity' },
    size: { width: 170, height: 72 },
  },
  {
    type: 'automatedActivity',
    name: 'Automated Activity',
    hint: 'Step · A',
    desc: 'An activity with potential for automation within a process (marked with an A in the corner).',
    defaultData: { label: 'Activity' },
    size: { width: 170, height: 72 },
  },
  {
    type: 'activitySystem',
    name: 'Activity + System',
    hint: 'Step · sys',
    desc: 'An activity that runs in a named system — the system (e.g. Symplicity, e-Services) shows in the coloured band. Double-click the band to name it.',
    defaultData: { label: 'Activity', system: 'System' },
    size: { width: 170, height: 94 },
  },
  {
    type: 'automatedActivitySystem',
    name: 'Automated + System',
    hint: 'Step · A · sys',
    desc: 'An automated activity that runs in a named system, shown in the coloured band (with the red A). Double-click the band to name the system.',
    defaultData: { label: 'Activity', system: 'System' },
    size: { width: 170, height: 94 },
  },
  {
    type: 'decision',
    name: 'Decision',
    hint: 'Branch',
    desc: 'A decision point with predefined alternatives, e.g. Yes / No.',
    defaultData: { label: 'Decision?' },
    // Kept deliberately shallow so a tower of Review/Endorse/Approve across
    // adjacent lanes never touches — see the LANE_H note in board.js.
    size: { width: 160, height: 76 },
  },
  {
    type: 'referencedProcess',
    name: 'Referenced Process',
    hint: 'Link',
    desc: 'A process that is linked to the current process (preceding, intermediate, or subsequent).',
    defaultData: { label: 'Reference to a different process' },
    size: { width: 160, height: 80 },
  },
  {
    type: 'database',
    name: 'Database',
    hint: 'Store',
    desc: 'An organized collection of structured data, typically stored electronically in a computer system.',
    defaultData: { label: 'Database' },
    size: { width: 140, height: 90 },
  },
  {
    // An ANNOTATION, not a step: a question or note pinned to the map. Sand
    // speech-bubble so it reads as commentary rather than part of the flow —
    // never numbered, never in a stage, never a row in the procedure table.
    type: 'callout',
    name: 'Callout',
    hint: 'Note',
    desc: 'A question or comment pinned to the map — commentary, not a process step. Never numbered.',
    defaultData: { label: 'Question: …' },
    size: { width: 210, height: 92 },
  },
  {
    type: 'dataObject',
    name: 'Data Object',
    hint: 'Data',
    desc: 'An element of data, text, or information required or produced by activities — not necessarily a physical document.',
    defaultData: { label: 'Data Object' },
    size: { width: 130, height: 84 },
  },
]

export const SHAPE_MAP = Object.fromEntries(SHAPES.map((s) => [s.type, s]))

// Swim lanes represent process owners (one role per row).
export const DEFAULT_LANES = ['Approver', 'Reviewer', 'Process Team']

// Enum of the node types the AI is allowed to emit (swimlane excluded — it is a
// layout container the user adds manually).
export const AI_NODE_TYPES = [
  'startEnd',
  'activity',
  'automatedActivity',
  'activitySystem',
  'automatedActivitySystem',
  'decision',
  'referencedProcess',
  'database',
  'dataObject',
]
