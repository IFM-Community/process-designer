import { useEffect, useMemo, useRef, useState } from 'react'
import { presenterHeaderSvg, presenterBodySvg } from '../lib/exportSvg'

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

export default function PresenterView({ board, fullscreenable = true }) {
  const stageRef = useRef(null)
  const [zoom, setZoom] = useState(null) // null → "fit height" until measured
  const [full, setFull] = useState(false)

  const { ownerUrl, bodyUrl, H } = useMemo(() => {
    const header = presenterHeaderSvg(board)
    const body = presenterBodySvg(board)
    const h = parseFloat((header.match(/height="([\d.]+)"/) || [])[1]) || 600
    const toUrl = (s) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s)
    return { ownerUrl: toUrl(header), bodyUrl: toUrl(body), H: h }
  }, [board])

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
          <img
            className="pd-pv-body"
            src={bodyUrl}
            alt={board.title ? `${board.title} process` : 'Process'}
            draggable={false}
            style={{ height: px }}
          />
        </div>
      </div>
      <div className="pd-pv-hint">Scroll ← → to walk through the process · the owner column stays put</div>
    </div>
  )
}
