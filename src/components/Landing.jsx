import { useRef, useState } from 'react'
import { readAnyFile, ACCEPT, STRUCTURAL } from '../lib/importFile'

// The front door — the "Capture" stage.
//
// The app used to open straight into an editor, which assumes you already have a
// process in your head and know which of eighteen buttons starts one. This asks
// the only question that matters first: where is the process coming from?
//
// These are ALTERNATIVES, not steps — no 1/2/3, because numbering them implies you
// do one then the next. You pick whichever matches where your process is today.
//
// The repository list is NOT repeated here: the sidebar already owns "which
// processes exist", and duplicating it means two lists that can disagree.

export default function Landing({
  onGenerate, onImportSpec, onBlank, generating, onStop,
}) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null) // { kind: 'error'|'info', text }
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef(null)

  const takeFile = async (file) => {
    if (!file) return
    setNote(null)
    setBusy(true)
    try {
      const res = await readAnyFile(file)
      if (res.kind === STRUCTURAL) {
        // Visio: real shapes and real connections, so it becomes a map directly.
        onImportSpec(res.spec)
        setNote({
          kind: 'info',
          text: `Imported ${res.shapes} shapes and ${res.connections} connections` +
            (res.pages > 1 ? ` from page 1 of ${res.pages}.` : '.') +
            ' Check the lanes and flow — Visio files vary.',
        })
        return
      }
      // A document describes a process in prose, so it goes into the box for you
      // to check and trim before generating. A 130-page manual holds a dozen
      // processes; handing the lot to the model would produce one meaningless map.
      const big = res.chars > 12000
      setPrompt(big ? res.text.slice(0, 12000) : res.text)
      setNote({
        kind: big ? 'warn' : 'info',
        text: big
          ? `Read ${res.chars.toLocaleString()} characters from “${file.name}” — too much for one ` +
            'process, so the first 12,000 are in the box. Trim it to the ONE process you want, ' +
            'then generate.'
          : `Read ${res.chars.toLocaleString()} characters from “${file.name}”. Check it, then generate.`,
      })
    } catch (e) {
      setNote({ kind: 'error', text: e.message || String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pd-landing">
      <div className="pd-landing-inner">
        <header className="pd-landing-head">
          <h1>Start a process</h1>
          <p>Describe it, bring in a document, or draw it yourself. Whichever fits where your process is today.</p>
        </header>

        {/* 1 — describe it */}
        <section className="pd-landing-card is-primary">
          <div className="pd-landing-card-head">
            <span className="pd-landing-ico">✎</span>
            <div>
              <h2>Describe the process</h2>
              <p>Paste a brain-dump, an email, or meeting notes. Messy is fine.</p>
            </div>
          </div>
          <textarea
            rows={5}
            value={prompt}
            placeholder={'IFM Technical Team: identify hiring requests\nTechnical Head: review and endorse\nStudent: submit required information (is this a step?)\n…'}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="pd-landing-actions">
            <button
              className="pd-generate-btn"
              disabled={generating || !prompt.trim()}
              onClick={() => onGenerate(prompt.trim())}
            >
              {generating ? 'Generating…' : '⚡ Generate process'}
            </button>
            {generating && onStop && (
              <button className="pd-cmd-stop" onClick={onStop} title="Stop generating">◼ Stop</button>
            )}
            <span className="pd-hint-inline">Takes 2–4 minutes · opens as a new process</span>
          </div>
        </section>

        <div className="pd-landing-row">
          {/* 2 — bring one in */}
          <section
            className={`pd-landing-card pd-landing-drop ${dragging ? 'is-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); takeFile(e.dataTransfer.files?.[0]) }}
          >
            <div className="pd-landing-card-head">
              <span className="pd-landing-ico">⤓</span>
              <div>
                <h2>Import a file</h2>
                <p>Visio keeps its real shapes and connections. Word, PDF and text are read for their words.</p>
              </div>
            </div>
            <button className="pd-landing-dropzone" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? 'Reading…' : (<><strong>Drop a file here</strong><span>.vsdx · .docx · .pdf · .txt · .md</span></>)}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => { takeFile(e.target.files?.[0]); e.target.value = '' }}
            />
          </section>

          {/* 3 — draw it */}
          <section className="pd-landing-card">
            <div className="pd-landing-card-head">
              <span className="pd-landing-ico">▦</span>
              <div>
                <h2>Start from blank</h2>
                <p>Drag shapes onto the canvas yourself.</p>
              </div>
            </div>
            <button className="pd-landing-blank" onClick={onBlank}>Open an empty board →</button>
          </section>
        </div>

        {note && <div className={`pd-landing-note is-${note.kind}`}>{note.text}</div>}

      </div>
    </div>
  )
}
