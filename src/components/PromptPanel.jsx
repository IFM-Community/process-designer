import { useEffect, useState } from 'react'
import { generateProcess, editProcess, LOADED_SKILLS } from '../lib/ai'

// Prompt → process. One box, two ways to use it: build a map from a description,
// or tell the AI how to change the map that's already on the canvas. Both are
// grounded in every skill under /skills (see lib/ai.js).
export default function PromptPanel({ onGenerated, currentSpec, hasMap }) {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false) // 'new' | 'edit' | false
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)

  // K2 thinks for 2-4 minutes on a real process. Without a visible clock a live
  // request is indistinguishable from a hung one, which is exactly how this read.
  useEffect(() => {
    if (!loading) { setElapsed(0); return }
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [loading])
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`

  const run = async (mode) => {
    setError('')
    if (!prompt.trim()) {
      setError(mode === 'edit' ? 'Describe the change you want' : 'Please describe the process you want')
      return
    }
    setLoading(mode)
    try {
      if (mode === 'edit') {
        onGenerated(await editProcess({ instruction: prompt.trim(), spec: currentSpec() }))
      } else {
        // A generated process opens in its own session — never over the current map.
        onGenerated(await generateProcess({ prompt: prompt.trim() }), { asNew: true })
      }
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="pd-prompt">
      <div className="pd-section-title">✦ Prompt to Process</div>
      <p className="pd-section-sub">
        Describe a process and the AI builds it — or, with a map on the canvas, tell it what to change.
      </p>

      <div className="pd-field">
        <label>{hasMap ? 'Process description or change request' : 'Process description'}</label>
        <textarea
          rows={6}
          value={prompt}
          placeholder={
            hasMap
              ? 'Build: "Intern hiring: student applies, IFM screens…"\nChange: "Move the CSI approval before the faculty one and add an End after a rejection."'
              : 'e.g. New employee onboarding: submit request, HR review, IT provisions accounts, and finally archive.'
          }
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>

      {error && <div className="pd-error">{error}</div>}

      <button className="pd-generate-btn" onClick={() => run('new')} disabled={!!loading}>
        {loading === 'new' ? `Generating… ${clock}` : '⚡ Generate new process'}
      </button>
      {hasMap && (
        <button
          className="pd-generate-btn pd-generate-btn--alt"
          onClick={() => run('edit')}
          disabled={!!loading}
          title="Apply this instruction to the map currently on the canvas"
        >
          {loading === 'edit' ? `Updating… ${clock}` : '✎ Update current map'}
        </button>
      )}
      {loading ? (
        <span className="pd-hint">
          K2 reasons through the whole skill — this normally takes 2–4 minutes. The map opens in a
          new process when it's done.
        </span>
      ) : (
        <span className="pd-hint" title={LOADED_SKILLS.join('\n')}>
          Grounded in {LOADED_SKILLS.length} skill file{LOADED_SKILLS.length === 1 ? '' : 's'} from /skills.
          Generating opens a new process; updating changes this one.
        </span>
      )}
    </div>
  )
}
