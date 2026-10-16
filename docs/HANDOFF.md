# Handoff

Done: M5 verified green (typecheck, lint, 113 tests, build); legacy `backend/` + `frontend/` deleted and their references removed from eslint/prettier/README/CODEBASE.
Pending: set `VITE_SERVER_URL` at web build + server `CORS_ORIGINS`/`ALLOWED_DOMAINS` before deploy.
Failed: `browser` tool has no session tab, so shards/frosting still unverified in a real browser; `apps/web` has no `lint` script, use root `pnpm eslint`.
