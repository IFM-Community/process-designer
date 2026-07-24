import { useEffect, useState } from 'react'
import { EMPTY_CODE, SEGMENTS, codePrefix, codeFromTitle, sampleCode } from '../lib/processCode'
import { optionsFor, isKnownOption, addCustomOption } from '../lib/segmentOptions'

// The Process Card — a process's identity in one place.
//
// WHERE this lives took a few tries. Not the sidebar: that rail is for editing the
// board in front of you, and a code is not a drawing tool. Not the publish dialog:
// codes are stamped on every shape from the first day, long before anything is
// published. Not a hidden setting: the manual treats the card as the process's
// front page.
//
// So it opens from the CODE CHIP beside the title. The chip is the code, visible
// wherever you are, and clicking the thing you want to change is where anyone
// looks first. It carries what the People & Culture manual's own Process Card
// carries — number, owner, cycle time, and the links to the processes on either
// side of this one.

export default function ProcessCard({ session, sessions, onSave, onClose, onSuggestCode }) {
  const card = session.card || {}
  const [code, setCode] = useState({ ...EMPTY_CODE, ...(card.code || codeFromTitle(session.title)) })
  const [owner, setOwner] = useState(card.owner || '')
  const [cycleTime, setCycleTime] = useState(card.cycleTime || '')
  const [preceding, setPreceding] = useState(card.links?.preceding || [])
  const [subsequent, setSubsequent] = useState(card.links?.subsequent || [])
  const [thinking, setThinking] = useState(false)
  // Names typed for brand-new codes, keyed by segment, before they're saved.
  const [newName, setNewName] = useState({})
  const [optsVersion, setOptsVersion] = useState(0) // bump to re-read the option store

  const saveOption = (segKey) => {
    const val = code[segKey]
    if (!val) return
    addCustomOption(segKey, val, newName[segKey] || val)
    setNewName((n) => ({ ...n, [segKey]: '' }))
    setOptsVersion((v) => v + 1)
  }

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const others = sessions.filter((s) => s.id !== session.id)
  const toggle = (list, set, id) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const suggest = () => {
    setThinking(true)
    onSuggestCode(session)
      .then((c) => { if (c) setCode((cur) => ({ ...cur, ...c })) })
      .catch(() => {})
      .finally(() => setThinking(false))
  }

  const linkPicker = (label, hint, list, set, exclude) => (
    <div className="pd-card-links">
      <label className="pd-modal-label">{label}</label>
      <div className="pd-card-hint">{hint}</div>
      {others.length ? (
        <div className="pd-card-linklist">
          {others.map((s) => (
            <label key={s.id} className={`pd-card-link ${list.includes(s.id) ? 'is-on' : ''}`}>
              <input
                type="checkbox"
                checked={list.includes(s.id)}
                disabled={exclude.includes(s.id)}
                onChange={() => toggle(list, set, s.id)}
              />
              <span className="pd-card-link-code">{codePrefix(s.card?.code || codeFromTitle(s.title)) || '—'}</span>
              <span className="pd-card-link-title">{s.title}</span>
            </label>
          ))}
        </div>
      ) : (
        <div className="pd-card-hint">No other processes to link to yet.</div>
      )}
    </div>
  )

  return (
    <div className="pd-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="pd-modal is-card" role="dialog" aria-modal="true">
        <h2>Process card</h2>
        <p className="pd-modal-lead">
          How <strong>{session.title}</strong> is identified, and where it sits among the
          other processes. The number here is stamped on every step.
        </p>

        <label className="pd-modal-label">
          Process number
          <button className="pd-card-suggest" onClick={suggest} disabled={thinking}>
            {thinking ? '✦ thinking…' : '✦ Suggest from the map'}
          </button>
        </label>
        <div className="pd-card-code">
          {SEGMENTS.map((seg) => {
            const opts = optionsFor(seg.key, sessions) // eslint-disable-line no-unused-vars
            void optsVersion // re-read when a new option is saved
            const val = code[seg.key] || ''
            const isNew = val && !isKnownOption(seg.key, val, sessions)
            return (
              <div key={seg.key} className="pd-card-seg">
                <input
                  value={val}
                  placeholder={seg.options[0][0]}
                  title={`${seg.label} — ${seg.hint}. Type any code; save it to reuse it.`}
                  maxLength={4}
                  list={`seg-${seg.key}`}
                  onChange={(e) => setCode({ ...code, [seg.key]: e.target.value.toUpperCase() })}
                />
                <datalist id={`seg-${seg.key}`}>
                  {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </datalist>
                <span>{seg.label}</span>
                {/* Typed a code that isn't a known option? Offer to name it and
                    keep it, so it's in the dropdown next time. */}
                {isNew && (
                  <div className="pd-seg-new">
                    <input
                      className="pd-seg-newname"
                      value={newName[seg.key] || ''}
                      placeholder={`Name “${val}”`}
                      onChange={(e) => setNewName((n) => ({ ...n, [seg.key]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveOption(seg.key) }}
                    />
                    <button className="pd-seg-save" onClick={() => saveOption(seg.key)} title="Save this code so it appears in the list next time">
                      ＋ Add
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="pd-card-newhint">Type a new code in any box, then <strong>＋ Add</strong> to keep it for next time.</div>
        <div className="pd-card-preview">
          Steps will read <strong>{sampleCode(code)}</strong>, <strong>{sampleCode(code).replace(/1$/, '2')}</strong>, …
        </div>

        <div className="pd-card-two">
          <div>
            <label className="pd-modal-label">Process owner</label>
            <input
              className="pd-card-text"
              value={owner}
              placeholder="e.g. Head of IFM"
              onChange={(e) => setOwner(e.target.value)}
            />
          </div>
          <div>
            <label className="pd-modal-label">Cycle time</label>
            <input
              className="pd-card-text"
              value={cycleTime}
              placeholder="e.g. 10 working days"
              onChange={(e) => setCycleTime(e.target.value)}
            />
          </div>
        </div>

        {linkPicker('Preceding processes', 'What has to happen before this one starts.', preceding, setPreceding, subsequent)}
        {linkPicker('Subsequent processes', 'What this one hands off to.', subsequent, setSubsequent, preceding)}

        <div className="pd-modal-actions">
          <button className="pd-modal-ghost" onClick={onClose}>Cancel</button>
          <button
            className="pd-modal-go"
            onClick={() => {
              onSave({ code, owner: owner.trim(), cycleTime: cycleTime.trim(), links: { preceding, subsequent } })
              onClose()
            }}
          >
            Save &amp; renumber
          </button>
        </div>
      </div>
    </div>
  )
}
