# Handoff

Done: CI green on main (server tests stub `GOOGLE_CLIENT_ID` in vitest config, so no `.env` needed); legacy `backend/` + `frontend/` deleted; deploy config added (vercel.json buildCommand + render.yaml blueprint).
Pending: create the Render service first, then set web `VITE_SERVER_URL`/`VITE_GOOGLE_CLIENT_ID` on Vercel and server `CORS_ORIGINS` = Vercel URL, `GOOGLE_CLIENT_ID` (same value) on Render.
Failed: `browser` tool has no session tab, so shards/frosting still unverified in a real browser; `apps/web` has no `lint` script, use root `pnpm eslint`; Render free plan sleeps after 15 idle minutes and drops sockets.
