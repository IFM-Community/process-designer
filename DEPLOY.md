# Deploying to Railway

The app is one Node process in production: `server/prod.mjs` serves the built
frontend from `dist/`, the `/api` routes, and proxies `/k2` to the model with the
API key attached server-side. (In development it's two processes glued by Vite's
proxy — that proxy is dev-only, which is why production has its own front door.)

## 1. Push to GitHub

```bash
git remote add origin https://github.com/<IFM-Community-org>/process-designer.git
git branch -M main
git push -u origin main
```

Nothing secret is tracked: `.gitignore` excludes `*.local` (the API key) and
`data` (the SQLite database). The key is only ever read from `process.env`.

## 2. Create the Railway service

New Project → Deploy from GitHub repo → pick the repo. Railway detects Node and
runs `npm run build`, then `npm start`.

## 3. Add a VOLUME — this matters

The database is a file at `data/process-designer.db`. A container filesystem is
**ephemeral**: without a volume, every deploy or restart wipes every process.

In the service → **Variables → Volumes** → add a volume mounted at:

```
/app/data
```

## 4. Environment variables

| Variable | Value | Why |
|---|---|---|
| `K2_API_KEY` | the K2 key | the model call; kept server-side |
| `K2_API_URL` | the K2 endpoint URL | model endpoint (not in the repo) |
| `PD_HTTPS` | `1` | marks the login cookie `Secure` (Railway serves HTTPS) |
| `PD_REQUIRE_AUTH` | `1` | *(optional)* reject unauthenticated API calls |

`PORT` is injected by Railway — the server already reads it and binds `0.0.0.0`.

## 5. Rotate the key

The current K2 key has been pasted into a chat and appeared in a screenshot.
Before anything is shared, **issue a new key** and set it only in Railway's
variables and your local `.env.local`.

## Notes

- **Node ≥ 22.5** is required (`node:sqlite` is built in). `engines` declares it.
- The K2 endpoint is plain **http**. Browsers block mixed content, which is
  exactly why the browser calls the same-origin `/k2` path and the server makes
  the outbound call — no change needed, but don't "fix" it by calling K2 directly
  from the frontend.
- SQLite on a single volume suits one small service. If this ever needs more than
  one instance, that's the point to move to Postgres.
