// Turn any dropped file into something the app can build a process from.
//
// Two different kinds of import, and it matters which one you get:
//
//   STRUCTURAL (.vsdx) — the file already contains shapes AND connections, so it
//     converts directly into a map. Nothing is inferred.
//   TEXTUAL (.docx, .pdf, .txt, .md, .csv) — the file contains prose describing a
//     process. The text is extracted here and handed to the same AI path as the
//     "describe the process" box, so the result is a genuine reading of the
//     document rather than a guess at a picture of one.
//
// Images are neither: the model behind this app is text-only (verified against the
// endpoint — it answers "not a multimodal model"), so a screenshot of a process
// cannot be read at all. That is stated plainly rather than half-supported.

import { readZip } from './vsdx'

export const STRUCTURAL = 'structural'
export const TEXTUAL = 'textual'

const ext = (name) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()

export const ACCEPT = '.vsdx,.docx,.pdf,.txt,.md,.markdown,.csv,.tsv,.json'

const IMAGE = /^(png|jpe?g|gif|webp|bmp|tiff?|svg|heic)$/i

// ---------------------------------------------------------------- Word (.docx)
// Also a ZIP of XML, so the same reader works. Paragraphs become newlines, which
// matters: a process document's line breaks carry the step boundaries.
async function docxText(file) {
  const parts = await readZip(await file.arrayBuffer(), (n) => n === 'word/document.xml')
  const xml = parts.get('word/document.xml')
  if (!xml) throw new Error('That .docx has no readable document body.')
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), 'application/xml')
  const out = []
  for (const p of doc.getElementsByTagName('w:p')) {
    const runs = [...p.getElementsByTagName('w:t')].map((t) => t.textContent).join('')
    out.push(runs)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ---------------------------------------------------------------- PDF
// pdf.js, not a hand-rolled extractor. I tried the naive route first — walk the
// content streams, inflate them, scrape the Tj/TJ operators — and measured it
// against a real 130-page procedure manual: all 250 streams failed to inflate,
// and even had they not, this file's subset TrueType fonts need their ToUnicode
// CMaps or the text comes out as mojibake. pdf.js handles xref streams, object
// streams and encodings; reimplementing that badly is not worth 1MB saved.
//
// A scanned PDF still yields nothing — those are pictures of words — and the
// caller says so rather than returning an empty process.
async function pdfText(file) {
  const pdfjs = await import('pdfjs-dist')
  // The worker is bundled by Vite; without this pdf.js looks for it on a CDN,
  // which the app has no business depending on.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const task = pdfjs.getDocument({ data: await file.arrayBuffer() })
  const doc = await task.promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent()
    // Re-introduce line breaks: getTextContent gives positioned runs, and a
    // process document's line structure is where the step boundaries live.
    let line = []
    let lastY = null
    const out = []
    for (const item of content.items) {
      const y = item.transform?.[5]
      if (lastY !== null && Math.abs(y - lastY) > 2) { out.push(line.join('')); line = [] }
      line.push(item.str)
      lastY = y
    }
    if (line.length) out.push(line.join(''))
    pages.push(out.join('\n'))
  }
  // Free the worker. The method lives on the loading task in pdf.js 6 (it was on
  // the document before), so release whichever this build actually offers.
  try { await (task.destroy?.() ?? doc.destroy?.()) } catch {}
  return pages.join('\n\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

// ---------------------------------------------------------------- dispatcher
export async function readAnyFile(file) {
  const e = ext(file.name)

  if (IMAGE.test(e)) {
    throw new Error(
      `Can't read “${file.name}”. Reading a picture of a process needs a model that can see ` +
      'images, and the one this app uses is text-only. If the diagram came from Visio, export ' +
      'it as .vsdx — that keeps the real shapes and connections. Otherwise describe it in the box.',
    )
  }
  if (e === 'vsd') {
    throw new Error(
      `“${file.name}” is the old binary Visio format, which browsers can't open. In Visio use ` +
      'File → Save As → Visio Drawing (.vsdx) and try again.',
    )
  }
  if (e === 'doc') {
    throw new Error(
      `“${file.name}” is the old binary Word format. Save it as .docx and try again.`,
    )
  }

  if (e === 'vsdx') {
    const { importVsdx } = await import('./vsdx')
    const res = await importVsdx(file)
    return { kind: STRUCTURAL, ...res }
  }

  let body = ''
  if (e === 'docx') body = await docxText(file)
  else if (e === 'pdf') body = await pdfText(file)
  else if (['txt', 'md', 'markdown', 'csv', 'tsv', 'json'].includes(e)) body = (await file.text()).trim()
  else throw new Error(`Can't read “.${e || file.name}” files. Try .vsdx, .docx, .pdf, .txt or .md.`)

  if (!body || body.replace(/\s/g, '').length < 40) {
    throw new Error(
      e === 'pdf'
        ? `No text came out of “${file.name}”. If it's a scan or an exported picture, the words are ` +
          'an image and would need OCR. A PDF exported from Word or Visio should work.'
        : `“${file.name}” has almost no text in it.`,
    )
  }
  return { kind: TEXTUAL, text: body, chars: body.length }
}
