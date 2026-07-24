// Small SVG glyph for each shape type — used in the palette and the on-canvas
// shape-type picker.
export default function ShapeGlyph({ type, className = 'pd-glyph' }) {
  const common = { className }
  switch (type) {
    case 'startEnd':
      return <svg {...common} viewBox="0 0 40 24"><rect x="1" y="3" width="38" height="18" rx="9" fill="var(--pd-tan)" stroke="var(--pd-tan-dark)" /></svg>
    case 'decision':
      return <svg {...common} viewBox="0 0 40 24"><polygon points="20,2 38,12 20,22 2,12" fill="#fff" stroke="var(--pd-teal)" strokeWidth="1.5" /></svg>
    case 'database':
      return <svg {...common} viewBox="0 0 40 24"><path d="M4,6 C4,3 12,2 20,2 C28,2 36,3 36,6 L36,18 C36,21 28,22 20,22 C12,22 4,21 4,18 Z" fill="var(--pd-tan)" stroke="var(--pd-tan-dark)" /></svg>
    case 'dataObject':
      return <svg {...common} viewBox="0 0 40 24"><path d="M4,2 L36,2 L36,19 C26,15 14,24 4,19 Z" fill="#fff" stroke="var(--pd-teal)" strokeWidth="1.5" /></svg>
    case 'referencedProcess':
      return <svg {...common} viewBox="0 0 40 24"><rect x="2" y="3" width="36" height="18" fill="#fff" stroke="var(--pd-ink)" /><rect x="4" y="5" width="32" height="14" fill="none" stroke="var(--pd-accent-red)" /></svg>
    case 'automatedActivity':
      return <svg {...common} viewBox="0 0 40 24"><rect x="2" y="3" width="36" height="18" fill="#fff" stroke="var(--pd-ink)" /><text x="33" y="10" fontSize="8" fill="var(--pd-accent-red)" fontWeight="700">A</text></svg>
    case 'activitySystem':
      return <svg {...common} viewBox="0 0 40 24"><rect x="2" y="3" width="36" height="18" fill="#fff" stroke="var(--pd-ink)" /><rect x="2" y="15" width="36" height="6" fill="var(--pd-sand-50)" stroke="var(--pd-tan-dark)" strokeWidth="0.8" /></svg>
    case 'automatedActivitySystem':
      return <svg {...common} viewBox="0 0 40 24"><rect x="2" y="3" width="36" height="18" fill="#fff" stroke="var(--pd-ink)" /><text x="33" y="10" fontSize="7" fill="var(--pd-accent-red)" fontWeight="700">A</text><rect x="2" y="15" width="36" height="6" fill="var(--pd-sand-50)" stroke="var(--pd-tan-dark)" strokeWidth="0.8" /></svg>
    default:
      return <svg {...common} viewBox="0 0 40 24"><rect x="2" y="3" width="36" height="18" fill="#fff" stroke="var(--pd-ink)" /></svg>
  }
}
