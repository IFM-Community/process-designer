// Runs the local API (SQLite) and Vite together for `npm run dev`, and KEEPS THEM
// running. Each half is supervised independently: if one exits unexpectedly it is
// respawned, so a transient crash of either process no longer takes the whole
// thing down (the old behaviour — "if either dies, kill both" — turned any single
// hiccup into a full outage, which is exactly the "localhost:5173 can't be opened"
// problem this replaces).
//
// A crash LOOP is different from a blip: if a half exits repeatedly in a short
// window it is almost certainly a real error (bad code, port already in use), so
// after a few fast failures we stop retrying that half and print why, instead of
// respawning forever in the background.
//
// What this CANNOT do: survive its own parent being killed. Closing the terminal,
// an editor restart, or the OS sleeping ends `npm run dev` itself — nothing a
// child supervisor does can outlive that. For always-on, run it as a real service
// (launchd/pm2); this keeps it alive for the whole session it's running in.

import { spawn } from 'node:child_process'

const CHILDREN = [
  { name: 'api', cmd: process.execPath, args: ['server/index.mjs'] },
  { name: 'vite', cmd: process.execPath, args: ['node_modules/vite/bin/vite.js'] },
]

const MAX_FAST_RESTARTS = 5      // give up after this many crashes…
const FAST_WINDOW_MS = 10_000    // …within this window (a genuine crash loop)
const RESTART_DELAY_MS = 400     // small backoff so a flapping child can't busy-loop

let shuttingDown = false
const live = new Set()

function run(child) {
  const p = spawn(child.cmd, child.args, { stdio: 'inherit', shell: false })
  child.proc = p
  live.add(p)

  p.on('exit', (code, signal) => {
    live.delete(p)
    if (shuttingDown) return

    // Track how fast this child has been dying.
    const now = Date.now()
    child.crashes = (child.crashes || []).filter((t) => now - t < FAST_WINDOW_MS)
    child.crashes.push(now)

    if (child.crashes.length >= MAX_FAST_RESTARTS) {
      console.error(
        `\n[dev] "${child.name}" crashed ${child.crashes.length} times in ` +
        `${FAST_WINDOW_MS / 1000}s — this is a real error, not a blip. Not restarting it.\n` +
        `[dev] Fix the cause above, then run \`npm run dev\` again.`,
      )
      // A permanently-dead half means the app is broken; stop the rest too so the
      // failure is loud, not a half-working server that silently doesn't save.
      shutdown(1)
      return
    }

    console.error(
      `\n[dev] "${child.name}" exited (${signal || code}) — restarting it ` +
      `(${child.crashes.length}/${MAX_FAST_RESTARTS} recent).`,
    )
    setTimeout(() => { if (!shuttingDown) run(child) }, RESTART_DELAY_MS)
  })
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const p of live) { try { p.kill('SIGTERM') } catch {} }
  setTimeout(() => process.exit(code), 200)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

for (const child of CHILDREN) run(child)
