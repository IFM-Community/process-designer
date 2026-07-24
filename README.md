# Process Designer

A visual **swim-lane process designer**. The board has a title bar and a row per
process owner (role). Drag shapes onto a lane — they **snap into place and
auto-connect** with orthogonal arrows. Or describe the process in one sentence
and let **Prompt to Process** generate the whole swim-lane board with AI.

Built on **Vite + React + [React Flow](https://reactflow.dev/)**. The AI part
calls the **Anthropic API directly from the browser** (your API key is stored
only in your browser, never sent to any server).

## Run

```bash
cd process-designer
npm install
npm run dev
```

Open http://localhost:5173

## Using it

1. **Processes** — the sidebar lists your processes; "+ New process" starts
   another. Everything is saved in your browser (localStorage).
2. **Lanes** — rename each lane header on the board for the owning role; use
   "+ Lane" / "− Lane" in the toolbar to add or remove rows.
3. **Shapes** — drag a shape onto a lane. It snaps to the nearest lane + column
   and auto-connects (horizontally along a lane, vertically across lanes). Hover
   any shape to see its meaning in the sidebar; double-click text to edit.
4. **Prompt to Process** — enter your Anthropic API key, describe the process,
   and the AI builds the lanes + steps + arrows. Then refine by dragging.
5. **Toolbar** — Auto-connect toggle, **Select** (marquee-drag to pick many
   shapes) with **←col / col→** to shift a selected block by a whole column,
   Tidy layout, Fit view, **Export image** (downloads the whole map +
   gap-analysis box as a **transparent PNG**), Clear.

### Process-map shapes

| Shape | Meaning |
|-------|---------|
| Start / End | Start / end of a process (Sand pill) |
| Activity | An activity step (with numbering, e.g. HR-001-001-001) |
| Automated Activity | Activity with automation potential (red "A") |
| Decision | Decision point (diamond; branch arrows labelled Yes / No) |
| Referenced Process | Link to a separate process |
| Database | A data store (cylinder) |
| Data Object | A data / document artefact |

### Branding
The UI follows **MBZUAI brand guidelines** — primary **Navy Blue `#154677`** and
**Sand `#E5C687`**, Dark Navy `#0C2945` for body text, brand Red `#B52529` for
the automation flag, and a monospace face for numbering codes (Roboto Mono
intent). All colours live as CSS variables in [src/index.css](src/index.css); the
image export mirrors the same palette in [src/lib/exportSvg.js](src/lib/exportSvg.js).

Swim lanes (process owners) are the rows of the board itself — add, rename, or
remove them rather than dragging a lane shape.

## AI / API notes

- Direct endpoint: `POST https://api.anthropic.com/v1/messages` with the
  `anthropic-dangerous-direct-browser-access: true` header for browser calls.
- Default model `claude-opus-4-8`; switch to `claude-sonnet-5` in the sidebar
  (faster / cheaper).
- Output is constrained with structured outputs (`output_config.format` JSON
  schema) so it always parses; the schema includes lanes + per-step owner.
- ⚠️ A front-end key is only for local / demo use. To ship this to other users,
  move the API call behind a small backend proxy so the key stays server-side.

## Project layout

```
src/
  App.jsx              board, sessions, snapping, auto-connect, toolbar
  board.js             swim-lane geometry (lane/column snapping, edge handles)
  shapes.js            shape catalogue + default lanes
  context.js           BoardContext (label edits + sidebar hover info)
  nodes/
    ProcessNode.jsx    all process shapes (SVG + editable text + handles)
    StructureNodes.jsx title bar + role-lane nodes
    parts.jsx          shared editable label + connection handles
    nodes.css
  lib/
    anthropic.js       direct Anthropic call + output schema
    layout.js          AI spec -> swim-lane board layout
  components/
    Sidebar.jsx        processes list, palette, hover-explanation panel
    PromptPanel.jsx    Prompt to Process panel
```
