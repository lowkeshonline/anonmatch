# Anonmatch

Anonymous 1-on-1 text chat: Start → queue → paired with a stranger → real-time chat.
Either side can Skip or Leave.

## Layout

- `apps/server` — Node/Socket.IO server: matchmaking, sessions, chat, auth, HTTP API.
- `apps/web` — Vite + React SPA.
- `packages/shared` — shared contract (events, error codes, Zod schemas, state machine). Change this first.
- `backend/`, `frontend/` — legacy reference, read-only. Not built or served.

