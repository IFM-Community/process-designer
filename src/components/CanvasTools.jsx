// Direct-manipulation tools for the board.
//
// These live ON the canvas because that is what they act on — the shapes under
// your cursor, instantly. They used to sit in a global header row alongside
// Export and Clear, which put "select some shapes" and "delete everything" the
// same distance from your hand and at the same apparent level.
//
// Tidy & number is deliberately set apart behind a divider: every other control
// here is free, instant and reversible by doing it again, whereas Tidy rewrites
// content — it re-packs columns and renumbers every step.
export default function CanvasTools({
  selectMode, onSelectMode, selectedCount, onShiftCol, onTidy, onFit, onAddCallout,
}) {
  return (
    <div className="pd-tools">
      <button
        className={`pd-tool ${selectMode ? 'is-on' : ''}`}
        onClick={() => onSelectMode(!selectMode)}
        title="Marquee-select: drag a box to select several shapes (instead of panning)"
      >
        ⬚<span>Select</span>
      </button>

      <div className="pd-tool-sep" />

      <button
        className="pd-tool"
        disabled={!selectedCount}
        onClick={() => onShiftCol(-1)}
        title="Move the selected shapes one column left"
      >
        ←
      </button>
      <button
        className="pd-tool"
        disabled={!selectedCount}
        onClick={() => onShiftCol(1)}
        title="Move the selected shapes one column right, opening space"
      >
        →
      </button>
      {selectedCount > 0 && <span className="pd-tool-count">{selectedCount}</span>}

      <div className="pd-tool-sep" />

      {/* An annotation, not a shape you drop into the flow — it belongs with the
          canvas tools rather than the step palette. */}
      <button className="pd-tool" onClick={onAddCallout} title="Add a callout — a question or note pinned to the map (never numbered)">
        ￭<span>Callout</span>
      </button>

      <div className="pd-tool-sep" />

      <button className="pd-tool" onClick={onFit} title="Fit the whole process on screen">
        ⤢<span>Fit</span>
      </button>

      {/* Content, not view: re-packs the columns and renumbers every step. */}
      <div className="pd-tool-sep" />
      <button className="pd-tool is-content" onClick={onTidy} title="Re-pack the columns so arrows stop crossing boxes, re-route the arrows, and renumber the steps in flow order">
        ⇄<span>Tidy &amp; number</span>
      </button>
    </div>
  )
}
