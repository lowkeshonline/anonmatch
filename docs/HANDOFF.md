# Handoff

Done: Docker deploy added — apps/server/Dockerfile, apps/web/Dockerfile (nginx), docker-compose.yml, .dockerignore, .env.docker.example; both images build and the stack boots (health OK, SPA fallback OK, VITE_* inlined). Fixed config.ts env filter (exact-key match) so a container's HOSTNAME no longer crashes the strict schema. Fixed socket.ts: it called `io()` with no URL, so it dialed the page origin and nginx's SPA fallback answered `/socket.io` with HTML (parse error → connect_error toast); it now takes the same `VITE_SERVER_URL` base as api.ts.
Pending: real deploy — `cp .env.docker.example .env`, fill GOOGLE_CLIENT_ID, point CORS_ORIGINS/VITE_SERVER_URL at public URLs and rebuild web; no unit test yet for the config key-filter fix.
Failed: none new; vercel.json rewrites `/(.*)` to index.html, so a same-origin `/socket.io` would break there too — Vercel must set VITE_SERVER_URL and rely on the same cross-origin path.
