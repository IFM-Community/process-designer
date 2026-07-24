import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Read .env.local. K2_API_KEY has no VITE_ prefix, so it stays server-side:
  // the browser never sees it — the proxy below attaches it on the way out.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      port: 5173,
      open: true,
      // Proxy the K2 Aurora endpoint so the browser calls a same-origin path.
      // Without this, a direct fetch to the raw IP is blocked by CORS (and by
      // mixed-content rules if the app is ever served over https).
      proxy: {
        // Local SQLite API (server/index.mjs) — where processes are saved.
        '/api': { target: `http://127.0.0.1:${env.PD_API_PORT || 5174}`, changeOrigin: false },
        '/k2': {
          target: env.K2_API_URL, // set in .env.local; deliberately not hardcoded
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/k2/, ''),
          headers: env.K2_API_KEY ? { Authorization: `Bearer ${env.K2_API_KEY}` } : undefined,
        },
      },
    },
  }
})
