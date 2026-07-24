import { useEffect, useState } from 'react'
import { allDepartments, draftSummary, publishState } from '../lib/publish'

// Publishing, as one action with a confirmation in front of it.
//
// It was briefly two buttons — Approve, then Publish — with a prompt asking who
// approved it. That invented a role nobody had: the person at the keyboard typed
// their own name into a field claiming someone had signed off. One button with a
// deliberate "are you approving this?" step is the honest version of the same
// gate. When approval really does get routed to another person, THAT is what fills
// this record in; until then it says only that the publisher stood behind it.
//
// Three states, because there are three different things you can mean by clicking
// Publish: approve a new one, push edits readers haven't seen, or take it down.

export default function PublishDialog({ session, sessions, onPublish, onWithdraw, onClose, onWriteSummary }) {
  const state = publishState(session)
  const [step, setStep] = useState(state === 'draft' ? 'approve' : 'manage')
  const [dept, setDept] = useState(session.publish?.department || '')
  const [newDept, setNewDept] = useState('')
  const [summary, setSummary] = useState(session.publish?.summary || '')
  const [writing, setWriting] = useState(false)

  const steps = (session.nodes || []).filter((n) => n.type !== 'startEnd')
  const depts = allDepartments(sessions)

  // Escape closes; a modal you can't dismiss with the keyboard is a trap.
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // The description writes itself when you reach the details step. A local draft
  // fills the box immediately so nothing is ever blocked on the model, and the AI
  // sentence replaces it when it lands — unless you have started typing, in which
  // case your words win.
  useEffect(() => {
    if (step !== 'details' || summary.trim()) return
    setSummary(draftSummary(session))
    let live = true
    setWriting(true)
    onWriteSummary(session)
      .then((line) => { if (live && line) setSummary((cur) => (cur === draftSummary(session) ? line : cur)) })
      .catch(() => {})
      .finally(() => { if (live) setWriting(false) })
    return () => { live = false }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const chosenDept = (newDept.trim() || dept).trim()

  const shell = (children) => (
    <div className="pd-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="pd-modal" role="dialog" aria-modal="true">{children}</div>
    </div>
  )

  if (step === 'approve') {
    return shell(
      <>
        <h2>Approve this process?</h2>
        <p className="pd-modal-lead">
          Publishing puts <strong>{session.title}</strong> in the library as the answer
          everyone is given. Approve it only if it describes how the work is actually
          meant to be done.
        </p>
        <div className="pd-modal-facts">
          <span><strong>{steps.length}</strong> steps</span>
          <span><strong>{(session.laneLabels || []).length}</strong> owners</span>
          <span><strong>{(session.edges || []).length}</strong> connections</span>
        </div>
        <div className="pd-modal-actions">
          <button className="pd-modal-ghost" onClick={onClose}>Cancel</button>
          <button className="pd-modal-go" onClick={() => setStep('details')}>Approve &amp; continue →</button>
        </div>
      </>
    )
  }

  if (step === 'manage') {
    return shell(
      <>
        <h2>{state === 'outdated' ? 'Readers are on an older version' : 'This process is published'}</h2>
        <p className="pd-modal-lead">
          {state === 'outdated'
            ? <>The library still shows the version published on{' '}
                {new Date(session.publish.publishedAt).toLocaleDateString()}. Your edits since
                then are not visible to readers until you publish again.</>
            : <>Readers see this exactly as it stands, published on{' '}
                {new Date(session.publish.publishedAt).toLocaleDateString()} under {session.publish.department}.</>}
        </p>
        <div className="pd-modal-actions">
          <button className="pd-modal-ghost" onClick={onClose}>Close</button>
          <button className="pd-modal-danger" onClick={() => setStep('withdraw')}>Withdraw from library</button>
          <button className="pd-modal-go" onClick={() => setStep('details')}>
            {state === 'outdated' ? 'Publish my edits →' : 'Update details →'}
          </button>
        </div>
      </>
    )
  }

  if (step === 'withdraw') {
    return shell(
      <>
        <h2>Withdraw from the library?</h2>
        <p className="pd-modal-lead">
          <strong>{session.title}</strong> will stop appearing in the library, and anyone
          searching for it will be told nothing covers that yet. Your draft is untouched —
          you can publish it again at any time.
        </p>
        <div className="pd-modal-actions">
          <button className="pd-modal-ghost" onClick={() => setStep('manage')}>Keep it published</button>
          <button className="pd-modal-danger" onClick={() => { onWithdraw(); onClose() }}>Withdraw</button>
        </div>
      </>
    )
  }

  return shell(
    <>
      <h2>Publish details</h2>
      <p className="pd-modal-lead">How this process is found and described in the library.</p>

      <label className="pd-modal-label">Department</label>
      <div className="pd-modal-dept">
        <select value={dept} onChange={(e) => { setDept(e.target.value); setNewDept('') }}>
          <option value="">Choose a department…</option>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="pd-modal-or">or</span>
        <input
          value={newDept}
          placeholder="Add a new one"
          onChange={(e) => setNewDept(e.target.value)}
        />
      </div>

      <label className="pd-modal-label">
        One line for readers
        {writing && <span className="pd-modal-writing">✦ writing…</span>}
      </label>
      <textarea
        className="pd-modal-summary"
        rows={2}
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="e.g. How to hire, contract and pay an intern at IFM."
      />
      <div className="pd-modal-hint">Written by AI from the map — edit it if it misses the point.</div>

      <div className="pd-modal-actions">
        <button className="pd-modal-ghost" onClick={onClose}>Cancel</button>
        <button
          className="pd-modal-go"
          disabled={!chosenDept || !summary.trim()}
          onClick={() => { onPublish({ department: chosenDept, summary: summary.trim() }); onClose() }}
        >
          {state === 'draft' ? 'Publish to library' : 'Update library'}
        </button>
      </div>
    </>
  )
}
