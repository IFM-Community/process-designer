// Layout invariant checker — used by the dev harness to prove a packed board has
// no arrow running through a shape. Deliberately checks BOTH axes: an earlier
// version only looked at vertical connectors and happily reported "0 crossings"
// on a board whose long horizontal edges ran straight through boxes.
export function checkLayout({ colOf, laneOf, ids, edges }) {
  const slot = new Map()
  const dupes = []
  for (const id of ids) {
    const k = `${laneOf(id)}:${colOf.get(id)}`
    if (slot.has(k)) dupes.push([slot.get(k), id])
    else slot.set(k, id)
  }
  const vertical = []
  const horizontal = []
  for (const e of edges) {
    if (!colOf.has(e.source) || !colOf.has(e.target)) continue
    const la = laneOf(e.source), lb = laneOf(e.target)
    const ca = colOf.get(e.source), cb = colOf.get(e.target)
    if (ca === cb) {
      const lo = Math.min(la, lb), hi = Math.max(la, lb)
      for (let L = lo + 1; L < hi; L++) {
        if (slot.has(`${L}:${ca}`)) { vertical.push(`${e.source}->${e.target} over ${slot.get(`${L}:${ca}`)}`); break }
      }
    }
    if (la === lb) {
      const lo = Math.min(ca, cb), hi = Math.max(ca, cb)
      for (let C = lo + 1; C < hi; C++) {
        if (slot.has(`${la}:${C}`)) { horizontal.push(`${e.source}->${e.target} through ${slot.get(`${la}:${C}`)}`); break }
      }
    }
  }
  return { duplicateSlots: dupes.length, vertical, horizontal, ok: !dupes.length && !vertical.length && !horizontal.length }
}
