# Progress

## Done

- **M0** — Read legacy, wrote `docs/legacy-contract.md`, locked the decisions below.

## Next

- **M1** — Scaffold: workspace, tsconfig, ESLint/Prettier, shared schemas, health
  route, Google OAuth session, Socket.IO handshake auth, `presence:count`, web
  page that signs in and shows the count.

## Decisions

| Topic | Decision |
|---|---|
| Legacy code | Stays at `backend/` + `frontend/`, read-only. Deleted after MVP verified. |
| Auth | Real Google OAuth via `@google-auth/library`. Domain allowlist from `ALLOWED_DOMAINS` env, comma-separated, `*` = allow all. |
| Auth transport | `POST /api/auth/google` → opaque token → Socket.IO handshake `auth`. Event contract unchanged. |
| PDF export | Dropped. Known regression, see legacy-contract. |
| Stores | `QueueStore`, `SessionStore` (chat pairs), `AuthSessionStore` (token → identity). **Deviation:** AGENTS.md specced two, auth forces a third. |
| Client states | `unauthenticated \| idle \| searching \| chatting \| ended`. **Deviation:** AGENTS.md specced four, auth forces a fifth. |
| Tailwind | v3.4, not v4. Stable shadcn/ui path. Legacy used v4. |
| Node | `engines: >=20`. Local machine runs 24. |
| React | 18 per AGENTS.md. Legacy runs 19. |
| Keys | Everything server-side is keyed by `socket.id`, never by an auth token. Prevents self-match and the two-tab overwrite. |
| Presence | Refcounted per identity, distinct identities with ≥1 live socket. |

## Deviations from AGENTS.md

Two, both forced by keeping auth in scope. Both approved.

1. Third store: `AuthSessionStore`.
2. Fifth client state: `unauthenticated`.

## Dependencies added beyond the AGENTS.md list

- `@google-auth/library` — Google ID token verification. Approved.
- `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` — shadcn/ui primitives (M4).
- Tooling implied by spec: `tsup`, `tsx`, `vitest`, `eslint`, `prettier`, `typescript`, `zod`, `tailwindcss`, `postcss`, `autoprefixer`, `@types/node`.

## Env vars

| Var | Used by | Notes |
|---|---|---|
| `PORT` | server | |
| `HOST` | server | |
| `CORS_ORIGINS` | server | Comma-separated. No `*` + credentials. |
| `GOOGLE_CLIENT_ID` | server | Verifies the ID token audience. |
| `ALLOWED_DOMAINS` | server | Comma-separated emails/domains, `*` = allow all. |
| `VITE_SERVER_URL` | web | |
| `VITE_GOOGLE_CLIENT_ID` | web | |