// The options behind each code segment (Entity, Process group, Process, …).
//
// The built-in lists in processCode.js are a STARTING point, not a fixed menu —
// an organisation invents process groups faster than anyone edits a constant. So
// the real option list for a segment is three things merged:
//
//   1. the built-in defaults (with their labels)
//   2. codes the user has SAVED as reusable (with a name they chose) — kept here
//   3. codes already in use on existing processes (so nothing you've used vanishes)
//
// A code you type is always accepted (the field is free text); "saving" it just
// gives it a name and makes it reappear in the dropdown next time. Only the codes
// in bucket 2 can be removed — you can't delete a default or one that's in use.

import { SEGMENTS, codePrefix } from './processCode'

const STORE = 'pd.segmentOptions.v1'

const read = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {} } catch { return {} } }
const write = (v) => { try { localStorage.setItem(STORE, JSON.stringify(v)) } catch {} }

export const customOptions = (segKey) => read()[segKey] || [] // [[code, label], …]

export function addCustomOption(segKey, code, label) {
  const c = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!c) return
  const all = read()
  const list = (all[segKey] || []).filter(([v]) => v !== c)
  list.push([c, (label || '').trim() || c])
  all[segKey] = list
  write(all)
}

export function removeCustomOption(segKey, code) {
  const all = read()
  all[segKey] = (all[segKey] || []).filter(([v]) => v !== code)
  write(all)
}

// codes of a segment that appear on any process's card, so they stay suggestable.
function usedValues(segKey, sessions = []) {
  const seen = new Set()
  for (const s of sessions) {
    const v = s?.card?.code?.[segKey]
    if (v) seen.add(String(v).toUpperCase())
  }
  return [...seen]
}

// The merged [code, label] list for a segment, de-duplicated (first label wins).
export function optionsFor(segKey, sessions = []) {
  const seg = SEGMENTS.find((s) => s.key === segKey)
  const out = new Map()
  for (const [v, l] of seg?.options || []) if (!out.has(v)) out.set(v, l)
  for (const [v, l] of customOptions(segKey)) if (!out.has(v)) out.set(v, l)
  for (const v of usedValues(segKey, sessions)) if (!out.has(v)) out.set(v, v)
  return [...out.entries()]
}

// Is this code already a known option for the segment? Used to decide whether to
// offer "save as reusable".
export const isKnownOption = (segKey, code, sessions = []) =>
  !!code && optionsFor(segKey, sessions).some(([v]) => v === String(code).toUpperCase())

// A custom option can be removed; a default or in-use one cannot.
export const isRemovable = (segKey, code, sessions = []) =>
  customOptions(segKey).some(([v]) => v === code) &&
  !(SEGMENTS.find((s) => s.key === segKey)?.options || []).some(([v]) => v === code) &&
  !usedValues(segKey, sessions).includes(code)

export { codePrefix }
