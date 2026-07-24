import { useEffect, useRef, useState } from 'react'

// The AI actions for a process — NAMED and visible, not hidden behind a generic
// "Ask AI" button.
//
// I got this wrong first time: I collapsed Fill details / Analyse gaps / Group into
// phases into one pill because they behave identically (slow, scoped, fallible).
// That is how they look to the code, not to a person — who thinks "analyse the
// gaps", never "do an AI thing". Burying named jobs behind a generic label costs
// discoverability and buys nothing. So the jobs are on the surface, and free-text
// is one more option beside them.
//
// Docked at the bottom because of what they act on: not a shape (so not a palette
// item), not one step (so not a node menu), but the whole process.
//
// It stays out of the way until clicked, keeps working while you carry on editing,
// and shows a clock: an action that takes minutes with no visible progress is
// indistinguishable from one that has hung.

const EXAMPLES = [
  'Add a rejection path to every approval',
  'Move the CSI approval before the faculty one',
  'Merge the two signing steps into one',
  'Add a visa check for international students',
]

export default function CommandBar({
  onRun, actions = [], busyLabel, error, onDismissError, disabled, onStop,
}) {
  const busy = !!busyLabel
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [menuOpen, setMenuOpen] = useState(null) // label of the open dropdown, if any
  const ref = useRef(null)

  // A visible clock: 2-4 minutes of a static "Working…" reads as a hang.
  useEffect(() => {
    if (!busy) { setElapsed(0); return }
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [busy])

  useEffect(() => { if (open) ref.current?.focus() }, [open])

  // Auto-grow: height follows the content, capped so a very long instruction
  // scrolls inside the box rather than shoving the board off screen. Keyed on the
  // value so it shrinks back when the text is cleared after sending.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`
  }, [text, open])

  const submit = () => {
    const v = text.trim()
    if (!v || busy) return
    onRun(v)
    setText('')
  }

  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`

  if (!open) {
    return (
      <div className="pd-cmd-dock">
        <div className={`pd-cmd-bar ${busy ? 'is-busy' : ''}`}>
          {busy ? (
            <>
              <span className="pd-cmd-working">
                <span className="pd-cmd-spark">✦</span>{busyLabel}… {clock}
              </span>
              {onStop && <button className="pd-cmd-stop" onClick={onStop} title="Stop this AI action">◼ Stop</button>}
            </>
          ) : (
            <>
              {actions.map((a) => (
                a.menu ? (
                  // A grouped action: one button opens a small popover of related
                  // sub-actions (e.g. the gap-analysis controls), instead of three
                  // buttons crowding the dock.
                  <span className="pd-cmd-menuwrap" key={a.label}>
                    <button
                      className={`pd-cmd-job ${menuOpen === a.label ? 'is-open' : ''}`}
                      onClick={() => setMenuOpen(menuOpen === a.label ? null : a.label)}
                      disabled={disabled || a.disabled}
                      title={a.hint}
                    >
                      {a.label} <span className="pd-cmd-caret">▾</span>
                    </button>
                    {menuOpen === a.label && (
                      <>
                        <span className="pd-cmd-menu-scrim" onClick={() => setMenuOpen(null)} />
                        <span className="pd-cmd-menu">
                          {a.menu.map((m) => (
                            <button
                              key={m.label}
                              className="pd-cmd-menuitem"
                              onClick={() => { setMenuOpen(null); m.run() }}
                              disabled={m.disabled}
                              title={m.hint}
                            >
                              {m.label}
                            </button>
                          ))}
                        </span>
                      </>
                    )}
                  </span>
                ) : (
                  <button
                    key={a.label}
                    className="pd-cmd-job"
                    onClick={a.run}
                    disabled={disabled || a.disabled}
                    title={a.hint}
                  >
                    {a.label}
                  </button>
                )
              ))}
              <span className="pd-cmd-bar-sep" />
              <button
                className="pd-cmd-job is-ask"
                onClick={() => setOpen(true)}
                disabled={disabled}
                title="Describe a change in your own words"
              >
                ✦ Describe a change…
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="pd-cmd-dock is-open">
      <div className="pd-cmd">
        <div className="pd-cmd-row">
          <span className="pd-cmd-spark">✦</span>
          {/* A textarea, not a single-line input: a real instruction runs to a
              sentence or two, sometimes several lines, and a box that hides all but
              the last few words makes it impossible to check what you're sending.
              It grows with the text and wraps. Enter sends; Shift+Enter is a new
              line. */}
          <textarea
            ref={ref}
            className="pd-cmd-input"
            rows={1}
            value={text}
            placeholder="What should change? e.g. “add a rejection path to every approval” — Shift+Enter for a new line"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
              if (e.key === 'Escape') setOpen(false)
            }}
          />
          {busy && onStop ? (
            <button className="pd-cmd-stop" onClick={onStop} title="Stop this AI action">◼ Stop {clock}</button>
          ) : (
            <button className="pd-cmd-go" onClick={submit} disabled={busy || !text.trim()}>
              {busy ? `Working… ${clock}` : 'Update map'}
            </button>
          )}
          <button className="pd-cmd-close" onClick={() => setOpen(false)} title="Close (Esc)">✕</button>
        </div>

        {busy && (
          <div className="pd-cmd-status">
            {busyLabel} — 2–4 minutes. You can keep editing; the result lands in the
            process it started from.
          </div>
        )}

        {error && (
          <div className="pd-cmd-error">
            {error}
            <button onClick={onDismissError}>✕</button>
          </div>
        )}

        {!busy && !error && !text && (
          <div className="pd-cmd-examples">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => setText(ex)}>{ex}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
