import { useEffect, useMemo, useRef, useState } from 'react'
import { presenterHeaderSvg, presenterBodySvg } from '../lib/exportSvg'
import { SHAPE_MAP } from '../shapes'

// Must match exportSvg: the owner column width and the vertical breathing room the
// presenter body is drawn with. Used to place clickable hotspots over the static SVG.
const PRESENT_PAD_Y = 56

// The presenter — a process read the way you'd walk someone through it.
//
// NOT a free canvas. The owner column is PINNED on the left and you scroll the
// body left-to-right through the process, so you never lose track of who owns the
// step you're looking at. That is the whole point of a swim-lane, and a free
// pan/zoom throws it away the moment you drag.
//
// The one thing a static presenter lacked is getting CLOSER — a long process at
// fit-height has tiny labels. So there is a zoom that scales the owner column and
// the body together (they share an intrinsic height, so they stay aligned at any
// zoom), plus full-screen for when even that isn't enough room.

const HEADER_W = 152 // must match exportSvg's owner-column width

export default function PresenterView({ board, fullscreenable = true, highlightOwner = '', onOpenRef }) {
  const stageRef = useRef(null)
  // Referenced-process boxes the reader can click — the map here is a static SVG,
  // so we overlay a transparent hotspot over each one and call back on click.
  const refNodes = useMemo(
    () => (onOpenRef ? (board.nodes || []).filter((n) => n.type === 'referencedProcess' && n.position) : []),
    [board.nodes, onOpenRef],
  )
  const [zoom, setZoom] = useState(null) // null → "fit height" until measured
  const [full, setFull] = useState(false)

  const { ownerUrl, bodyUrl, H } = useMemo(() => {
    const header = presenterHeaderSvg({ ...board, highlightOwner })
    const body = presenterBodySvg({ ...board, highlightOwner })
    const h = parseFloat((header.match(/height="([\d.]+)"/) || [])[1]) || 600
    const toUrl = (s) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s)
    return { ownerUrl: toUrl(header), bodyUrl: toUrl(body), H: h }
  }, [board, highlightOwner])

  // Fit = the whole height of the process in the stage, so you scroll only
  // sideways. This is the presenter's resting state.
  const fit = () => {
    const st = stageRef.current
    if (!st) return
    setZoom((st.clientHeight - 24) / H)
  }
  useEffect(() => { fit() }, [H])
  useEffect(() => { const r = requestAnimationFrame(fit); return () => cancelAnimationFrame(r) }, [full])

  useEffect(() => {
    if (!full) return
    const h = (e) => { if (e.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [full])

  // The presenter only scrolls SIDEWAYS, but two common inputs don't do that on
  // their own, which reads as "I can't move it":
  //   · a mouse wheel is vertical, and at "fit" there's no vertical room, so it
  //     does nothing → translate a vertical wheel into a horizontal walk-through.
  //   · dragging feels like the natural way to move a big board → grab-to-scroll.
  // Both defer to real vertical scrolling when zoomed in past the stage height,
  // and to native horizontal trackpad gestures.
  useEffect(() => {
    const st = stageRef.current
    if (!st) return

    const onWheel = (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return // native horizontal gesture
      if (st.scrollHeight - st.clientHeight > 2) return    // zoomed in: let it scroll vertically
      if (e.deltaY === 0) return
      st.scrollLeft += e.deltaY
      e.preventDefault()
    }

    let dragging = false
    let startX = 0
    let startLeft = 0
    const onDown = (e) => {
      if (e.button !== 0) return
      dragging = true
      startX = e.clientX
      startLeft = st.scrollLeft
      st.classList.add('is-grabbing')
      st.setPointerCapture?.(e.pointerId)
    }
    const onMove = (e) => {
      if (!dragging) return
      st.scrollLeft = startLeft - (e.clientX - startX)
    }
    const onUp = () => { dragging = false; st.classList.remove('is-grabbing') }

    st.addEventListener('wheel', onWheel, { passive: false })
    st.addEventListener('pointerdown', onDown)
    st.addEventListener('pointermove', onMove)
    st.addEventListener('pointerup', onUp)
    st.addEventListener('pointerleave', onUp)
    return () => {
      st.removeEventListener('wheel', onWheel)
      st.removeEventListener('pointerdown', onDown)
      st.removeEventListener('pointermove', onMove)
      st.removeEventListener('pointerup', onUp)
      st.removeEventListener('pointerleave', onUp)
    }
  }, [])

  const k = zoom || 1
  const px = H * k

  return (
    <div className={`pd-pv ${full ? 'is-full' : ''}`}>
      <div className="pd-pv-ctrls">
        <button onClick={() => setZoom((z) => Math.max(0.15, (z || 1) / 1.2))} title="Zoom out">−</button>
        <button className="pd-pv-fit" onClick={fit} title="Fit the whole process height">Fit</button>
        <button onClick={() => setZoom((z) => Math.min(4, (z || 1) * 1.2))} title="Zoom in">+</button>
        {fullscreenable && (
          <button onClick={() => setFull((v) => !v)} title={full ? 'Exit full screen (Esc)' : 'Full screen'}>
            {full ? '✕' : '⛶'}
          </button>
        )}
      </div>
      <div className="pd-pv-stage" ref={stageRef}>
        <div className="pd-pv-track" style={{ height: px }}>
          <img
            className="pd-pv-owner"
            src={ownerUrl}
            alt="Owners"
            draggable={false}
            style={{ height: px, width: HEADER_W * k }}
          />
          <div className="pd-pv-bodywrap" style={{ position: 'relative', height: px }}>
            <img
              className="pd-pv-body"
              src={bodyUrl}
              alt={board.title ? `${board.title} process` : 'Process'}
              draggable={false}
              style={{ height: px, display: 'block' }}
            />
            {/* Clickable hotspots over the referenced-process boxes. Positioned from
                the same coordinates the SVG is drawn with (body viewBox starts at
                HEADER_W; nodes offset by PRESENT_PAD_Y), scaled by the zoom k. */}
            {refNodes.map((n) => {
              const size = SHAPE_MAP[n.type]?.size || { width: 160, height: 80 }
              const imgs = n.data?.images?.length || 0
              return (
                <button
                  key={n.id}
                  className="pd-pv-hotspot"
                  style={{
                    left: (n.position.x - HEADER_W) * k,
                    top: (n.position.y + PRESENT_PAD_Y) * k,
                    width: size.width * k,
                    height: size.height * k,
                  }}
                  title={imgs ? `View ${imgs} image${imgs > 1 ? 's' : ''}` : `Open “${n.data?.label || 'process'}”`}
                  // Stop the press from starting a pan on the stage — otherwise the
                  // stage captures the pointer and the button's click never fires,
                  // so it looks selectable but "clicking does nothing".
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onOpenRef(n) }}
                />
              )
            })}
          </div>
        </div>
      </div>
      <div className="pd-pv-hint">Scroll ← → to walk through the process · the owner column stays put</div>
    </div>
  )
}
