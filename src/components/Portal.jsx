import { useMemo, useState } from 'react'
import { DEPARTMENTS, isPublished, rankProcesses } from '../lib/publish'
import { coverArtUrl } from '../lib/coverArt'

// The FRONTEND — what everyone at the university sees.
//
// Its first question is not "which process do you want to read?" but "what are you
// trying to do?", because a reader arrives with a task ("I need to hire an intern"),
// not with the name of a document. Matching is instant and local: someone asking a
// question deserves an answer now, not a 2-4 minute model call.
//
// Below that, a gallery by department, because browsing is how you find the thing
// you didn't know to search for.
//
// Only PUBLISHED processes appear here. Drafts are the authors' business — a
// half-finished map going live to the whole university the moment somebody typed
// into it is exactly what publishing exists to prevent.

export default function Portal({ sessions, onOpen, onGoToStudio }) {
  const [q, setQ] = useState('')
  const [dept, setDept] = useState(null)

  const published = useMemo(() => sessions.filter(isPublished), [sessions])
  const matches = useMemo(() => rankProcesses(published, q), [published, q])

  const byDept = useMemo(() => {
    const m = new Map()
    for (const s of published) {
      const d = s.publish?.department || 'Other'
      if (!m.has(d)) m.set(d, [])
      m.get(d).push(s)
    }
    return [...m.entries()].sort((a, b) => DEPARTMENTS.indexOf(a[0]) - DEPARTMENTS.indexOf(b[0]))
  }, [published])

  const drafts = sessions.filter((s) => !isPublished(s)).length

  // Built once per published set, not per render — at 250 processes this is the
  // only work the gallery does that scales with the catalogue.
  const thumbs = useMemo(() => {
    const m = new Map()
    for (const s of published) m.set(s.id, coverArtUrl(s))
    return m
  }, [published])

  // A card shows the SHAPE of the process, then its name. You recognise a process
  // you have seen before by its picture faster than by reading six similar titles.
  const card = (s) => {
    const snap = s.publish?.snapshot || s
    const thumb = thumbs.get(s.id)
    return (
      <button key={s.id} className="pd-pt-card" onClick={() => onOpen(s.id)}>
        <span className="pd-pt-thumb">
          {thumb ? <img src={thumb} alt="" /> : <span className="pd-pt-thumb-none">No steps</span>}
          <span className="pd-pt-thumb-dept">{s.publish?.department}</span>
        </span>
        <span className="pd-pt-card-body">
          <span className="pd-pt-card-title">{snap.title}</span>
          {s.publish?.summary && <span className="pd-pt-card-sum">{s.publish.summary}</span>}
          <span className="pd-pt-card-meta">
            {(snap.nodes || []).filter((n) => n.type !== 'startEnd').length} steps ·{' '}
            {(snap.laneLabels || []).length} owners
            {s.publish?.approval?.by ? ` · approved by ${s.publish.approval.by}` : ''}
          </span>
        </span>
      </button>
    )
  }

  return (
    <div className="pd-portal">
      <div className="pd-portal-inner">
        <header className="pd-pt-head">
          <h1>What are you trying to do?</h1>
          <p>Ask in your own words and we’ll point you at the process that covers it.</p>
          <input
            className="pd-pt-ask"
            value={q}
            placeholder="e.g. I want to hire an intern — what should I do?"
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </header>

        {q.trim() && (
          <section className="pd-pt-answer">
            {matches.length ? (
              <>
                <h3>{matches.length === 1 ? 'This is the process you want' : 'These look closest'}</h3>
                <div className="pd-pt-grid">{matches.slice(0, 4).map((m) => card(m.session))}</div>
              </>
            ) : (
              <div className="pd-pt-none">
                <strong>Nothing published covers that yet.</strong>
                <span>
                  {published.length
                    ? `Searched ${published.length} published process${published.length === 1 ? '' : 'es'}. Try different words, or browse below.`
                    : 'No processes have been published yet.'}
                </span>
              </div>
            )}
          </section>
        )}

        {!published.length ? (
          <section className="pd-pt-empty">
            <h3>The library is empty</h3>
            <p>
              Nothing has been published yet
              {drafts ? `, though there ${drafts === 1 ? 'is' : 'are'} ${drafts} draft${drafts === 1 ? '' : 's'} in the studio` : ''}.
              A process appears here once its author publishes it.
            </p>
            <button className="pd-generate-btn" onClick={onGoToStudio}>Go to the studio →</button>
          </section>
        ) : !dept ? (
          // Top level is the DEPARTMENTS, not every process. With 250 processes a
          // flat wall is unusable; the gallery a reader browses is "Finance, HR,
          // …", and you drill into one to see its processes.
          <section className="pd-pt-gallery">
            <h3 className="pd-pt-gallery-head">Browse by department</h3>
            <div className="pd-pt-grid is-depts">
              {byDept.map(([d, list]) => (
                <button key={d} className="pd-pt-deptcard" onClick={() => setDept(d)}>
                  <span className="pd-pt-deptcard-thumbs">
                    {list.slice(0, 3).map((s) => {
                      const t = thumbs.get(s.id)
                      return (
                        <span className="pd-pt-deptcard-thumb" key={s.id}>
                          {t ? <img src={t} alt="" /> : null}
                        </span>
                      )
                    })}
                  </span>
                  <span className="pd-pt-deptcard-body">
                    <span className="pd-pt-deptcard-name">{d}</span>
                    <span className="pd-pt-deptcard-count">
                      {list.length} process{list.length === 1 ? '' : 'es'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          // Inside a department: its processes, with a way back up.
          <section className="pd-pt-gallery">
            <button className="pd-reader-back" onClick={() => setDept(null)}>← All departments</button>
            <h3 className="pd-pt-gallery-head">
              {dept} <span>{(byDept.find(([d]) => d === dept)?.[1] || []).length}</span>
            </h3>
            <div className="pd-pt-grid">
              {(byDept.find(([d]) => d === dept)?.[1] || []).map(card)}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
