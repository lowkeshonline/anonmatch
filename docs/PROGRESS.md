# Progress

## Done

- **M0** — Read legacy, wrote `docs/legacy-contract.md`, locked the decisions below.
- **M1** — Scaffold. pnpm workspace, strict TS everywhere, ESLint + Prettier,
  `packages/shared` holding the full event contract, server health route,
  verified Google OAuth, Socket.IO handshake auth, live `presence:count`, and a
  web app that signs in and shows the count.

## Next

- **M2** — Server core: `QueueStore`, `SessionStore`, `AuthSessionStore`
  interfaces plus in-memory impls; `MatchmakingService`, `SessionService`,
  `ChatService`; thin transport handlers; the state machine. Unit tests for FIFO,
  no self-match, double join, leave, disconnect cleanup, skip, stale socket ids,
  rate limit, message length. Plus a scripted two-client `socket.io-client` test.

## Decisions

| Topic          | Decision                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy code    | Stays at `backend/` + `frontend/`, read-only. Deleted after MVP verified.                                                                    |
| Auth           | Real Google OAuth via `google-auth-library`. Domain allowlist from `ALLOWED_DOMAINS` env, comma-separated, `*` = allow all.                  |
| Auth transport | `POST /api/auth/google` → opaque token → Socket.IO handshake `auth`. Event contract unchanged.                                               |
| PDF export     | Dropped. Known regression, see legacy-contract.                                                                                              |
| Stores         | `QueueStore`, `SessionStore` (chat pairs), `AuthSessionStore` (token → identity). **Deviation:** AGENTS.md specced two, auth forces a third. |
| Client states  | `unauthenticated \| idle \| searching \| chatting \| ended`. **Deviation:** AGENTS.md specced four, auth forces a fifth.                     |
| React          | 18 per AGENTS.md. Legacy runs 19.                                                                                                            |
| Tailwind       | v3.4, not v4. Stable shadcn/ui path. Legacy uses v4.                                                                                         |
| TypeScript     | **5.9.3, not 7.** `typescript-eslint@8.71.2` declares `typescript: >=4.8.4 <6.1.0`, so TS 7 cannot be linted type-aware.                     |
| Vite           | 8 with `@vitejs/plugin-react@5.2.0`. plugin-react 6 pulls three extra babel/oxc peers.                                                       |
| Node           | `engines: >=20`. Local machine runs 24.                                                                                                      |
| Keys           | Everything server-side is keyed by `socket.id`, never by an auth token. Prevents self-match and the two-tab overwrite.                       |
| Presence       | Refcounted per identity, distinct identities with ≥1 live socket.                                                                            |
| Shared package | Ships TypeScript source via `exports`, builds to `dist` only for standalone publish. Removes the dev build-order race.                       |
| Env parsing    | `process.env` filtered to our own prefixes, then `strictObject`. Catches typos like `GOOGLE_CLIENT_IDD` without choking on PATH and TERM.    |

## Deviations from AGENTS.md

Two, both forced by keeping auth in scope. Both approved.

1. Third store: `AuthSessionStore`.
2. Fifth client state: `unauthenticated`.

Plus one version pin forced by the toolchain: TypeScript 5.9.3 instead of latest.

## Dependencies added beyond the AGENTS.md list

- `google-auth-library` — Google ID token verification. Approved.
- `@react-oauth/google` — Google sign-in button. **Not yet approved.**
- `socket.io-client` in `apps/server` devDeps — M2's two-client test needs it.
- `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` — shadcn/ui primitives, still unused, land in M4.
- Tooling implied by spec: `tsup`, `tsx`, `vitest`, `eslint`, `prettier`, `typescript`, `zod`, `tailwindcss`, `postcss`, `autoprefixer`, `@types/node`, `@types/express`.

## M1 verification

| Check                                          | Result                                                         |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `pnpm typecheck`                               | pass (shared, server, web)                                     |
| `pnpm lint`                                    | pass                                                           |
| `pnpm format:check`                            | pass                                                           |
| `pnpm test`                                    | pass (no test files yet, M2 adds them)                         |
| `pnpm dev`                                     | pass, both up, Vite proxy reaches `/health`                    |
| `pnpm -r build`                                | pass (tsup + vite build)                                       |
| `GET /health`                                  | `{"status":"ok",...}`                                          |
| `POST /api/auth/google` with `{}`              | 400 `INVALID_PAYLOAD`                                          |
| `POST /api/auth/google` with a fake credential | 401 `invalid_credential` (real Google verification rejects it) |
| Socket, no credentials                         | `connect_error` `NOT_AUTHENTICATED`                            |
| Socket, unknown token                          | `connect_error` `NOT_AUTHENTICATED`                            |
| Presence 1 user                                | 1                                                              |
| Presence 2 users                               | 2 on both sockets                                              |
| Same identity, 2 tabs                          | still 2                                                        |
| Close 1 of 2 tabs                              | still 2                                                        |
| Close last socket                              | 0                                                              |

## Setup

```sh
pnpm install
cp apps/server/.env.example apps/server/.env    # set GOOGLE_CLIENT_ID
cp apps/web/.env.example apps/web/.env          # set VITE_GOOGLE_CLIENT_ID (same client ID)
pnpm dev
```

`GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` must be the same OAuth client ID.
The server refuses to boot without `GOOGLE_CLIENT_ID`.

## Env vars

| Var                     | Used by | Notes                                            |
| ----------------------- | ------- | ------------------------------------------------ |
| `PORT`                  | server  | default 4000                                     |
| `HOST`                  | server  | default 0.0.0.0                                  |
| `CORS_ORIGINS`          | server  | Comma-separated allowlist. No `*` + credentials. |
| `GOOGLE_CLIENT_ID`      | server  | Verifies the ID token audience.                  |
| `ALLOWED_DOMAINS`       | server  | Comma-separated emails/domains, `*` = allow all. |
| `SESSION_TTL_HOURS`     | server  | default 24                                       |
| `VITE_SERVER_URL`       | web     | Blank = same origin (Vite proxies in dev).       |
| `VITE_GOOGLE_CLIENT_ID` | web     |                                                  |
