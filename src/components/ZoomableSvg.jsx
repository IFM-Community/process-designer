import { useCallback, useEffect, useRef, useState } from 'react'

// A pan-and-zoom viewer for a rendered process map.
//
// The reader used to show the map as a plain <img> scaled to fit the card width,
// which made every label unreadable — a whole swim-lane process squeezed into
// ~900px is a grey smudge. This is the presenter the reader needs: wheel or the
// +/− buttons to zoom, drag to pan, Fit to frame the whole thing again, and a
// full-screen toggle for when even that is not enough room.
//
// It takes the SVG as a string so it stays read-only: there is no board, no
// nodes, nothing to edit — just an image you can get close to.

export default function ZoomableSvg({ svg, title }) {
  const wrapRef = useRef(null)
  const [t, setT] = useState({ x: 0, y: 0, k: 1 })
  const [full, setFull] = useState(false)
  const drag = useRef(null)

  const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)

  // Frame the whole map in the current viewport. Runs on mount and whenever the
  // frame changes size (entering/leaving full screen).
  const fit = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
    const vw = m ? parseFloat(m[1]) : wrap.clientWidth
    const vh = m ? parseFloat(m[2]) : wrap.clientHeight
    const pad = 24
    const k = Math.min((wrap.clientWidth - pad * 2) / vw, (wrap.clientHeight - pad * 2) / vh)
    setT({ k, x: (wrap.clientWidth - vw * k) / 2, y: (wrap.clientHeight - vh * k) / 2 })
  }, [svg])

  useEffect(() => { fit() }, [fit])
  useEffect(() => { const r = requestAnimationFrame(fit); return () => cancelAnimationFrame(r) }, [full, fit])

  useEffect(() => {
    if (!full) return
    const h = (e) => { if (e.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [full])

  const zoomAt = (factor, cx, cy) => {
    setT((cur) => {
      const k = Math.min(6, Math.max(0.1, cur.k * factor))
      const r = k / cur.k
      // Keep the point under the cursor fixed while scaling.
      return { k, x: cx - (cx - cur.x) * r, y: cy - (cy - cur.y) * r }
    })
  }

  const onWheel = (e) => {
    e.preventDefault()
    const rect = wrapRef.current.getBoundingClientRect()
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top)
  }

  const onPointerDown = (e) => {
    drag.current = { px: e.clientX, py: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (!drag.current) return
    const dx = e.clientX - drag.current.px
    const dy = e.clientY - drag.current.py
    drag.current = { px: e.clientX, py: e.clientY }
    setT((cur) => ({ ...cur, x: cur.x + dx, y: cur.y + dy }))
  }
  const onPointerUp = () => { drag.current = null }

  const controls = (
    <div className="pd-zoom-ctrls">
      <button onClick={() => { const w = wrapRef.current; zoomAt(1.25, w.clientWidth / 2, w.clientHeight / 2) }} title="Zoom in">+</button>
      <button onClick={() => { const w = wrapRef.current; zoomAt(1 / 1.25, w.clientWidth / 2, w.clientHeight / 2) }} title="Zoom out">−</button>
      <button onClick={fit} title="Fit to screen">⤢</button>
      <button onClick={() => setFull((v) => !v)} title={full ? 'Exit full screen (Esc)' : 'Full screen'}>
        {full ? '✕' : '⛶'}
      </button>
    </div>
  )

  return (
    <div className={`pd-zoom ${full ? 'is-full' : ''}`}>
      {controls}
      <div
        ref={wrapRef}
        className="pd-zoom-frame"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <img
          src={src}
          alt={title ? `${title} process map` : 'Process map'}
          draggable={false}
          style={{
            transformOrigin: '0 0',
            transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})`,
          }}
        />
      </div>
    </div>
  )
}
