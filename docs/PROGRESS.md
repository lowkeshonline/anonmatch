# Progress

## Done

- **M0** — Read legacy, wrote `docs/legacy-contract.md`, locked the decisions below.
- **M1** — Scaffold. pnpm workspace, strict TS everywhere, ESLint + Prettier,
  `packages/shared` holding the full event contract, server health route,
  verified Google OAuth, Socket.IO handshake auth, live `presence:count`, and a
  web app that signs in and shows the count.
- **M1 hardening** — Fixed two defects found by real use. `tsx watch` never
  reloaded on `.env` change, so a stale client ID broke sign-in with an opaque
  Google error; `scripts/dev.mjs` now restarts on `.env` edits. And
  `auth-service.ts` was swallowing the verification error, collapsing
  wrong-audience, clock skew and a bad token into one message; it now classifies
  and logs the real reason.
- **Rename** — Chatwadi → Anonmatch across package scope, imports, storage keys,
  page title and UI copy. `backend/` and `frontend/` keep the old name.
- **M2** — Server core. `QueueStore` (FIFO) and `SessionStore` (user state +
  chat pairs) interfaces with in-memory implementations; `MatchmakingService`,
  `SessionService`, `ChatService`; the server-authoritative state machine; thin
  transport handlers. 98 tests: unit coverage of every rule, a hand-built
  two-client flow over real sockets, and an acceptance test that boots the real
  composition from `createChatServer`.

## Next

- **M3** — Frontend functional. Zustand store gains `searching` / `chatting` /
  `ended`, the four screens (Landing, Searching, Chat, Ended), Skip / Leave
  wired, typing indicator, plain styling. Accept: two tabs can match, chat, skip,
  leave and survive a disconnect.

## Decisions

| Topic             | Decision                                                                                                                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy code       | Stays at `backend/` + `frontend/`, read-only. Deleted after MVP verified.                                                                                                                                                                                               |
| Auth              | Real Google OAuth via `google-auth-library`. Domain allowlist from `ALLOWED_DOMAINS` env, comma-separated, `*` = allow all.                                                                                                                                             |
| Auth transport    | `POST /api/auth/google` → opaque token → Socket.IO handshake `auth`. Event contract unchanged.                                                                                                                                                                          |
| PDF export        | Dropped. Known regression, see legacy-contract.                                                                                                                                                                                                                         |
| Product name      | **Anonmatch.** Scope `@anonmatch/*`, storage keys `anonmatch.*`. Legacy `backend/` + `frontend/` keep the old name, which is what they are.                                                                                                                             |
| Dev env reload    | `tsx watch` cannot see dotfiles via `--include`; `node --watch --watch-path` misses `.ts` via the tsx loader. `scripts/dev.mjs` does both.                                                                                                                              |
| Stores            | `QueueStore`, `SessionStore` (chat pairs), `AuthSessionStore` (token → identity). **Deviation:** AGENTS.md specced two, auth forces a third.                                                                                                                            |
| Client states     | `unauthenticated \| idle \| searching \| chatting \| ended`. **Deviation:** AGENTS.md specced four, auth forces a fifth.                                                                                                                                                |
| React             | 18 per AGENTS.md. Legacy runs 19.                                                                                                                                                                                                                                       |
| Tailwind          | v3.4, not v4. Stable shadcn/ui path. Legacy uses v4.                                                                                                                                                                                                                    |
| TypeScript        | **5.9.3, not 7.** `typescript-eslint@8.71.2` declares `typescript: >=4.8.4 <6.1.0`, so TS 7 cannot be linted type-aware.                                                                                                                                                |
| Vite              | 8 with `@vitejs/plugin-react@5.2.0`. plugin-react 6 pulls three extra babel/oxc peers.                                                                                                                                                                                  |
| Node              | `engines: >=20`. Local machine runs 24.                                                                                                                                                                                                                                 |
| Keys              | Everything server-side is keyed by `socket.id`, never by an auth token. Prevents self-match and the two-tab overwrite.                                                                                                                                                  |
| Presence          | Refcounted per identity, distinct identities with ≥1 live socket.                                                                                                                                                                                                       |
| Shared package    | Ships TypeScript source via `exports`, builds to `dist` only for standalone publish. Removes the dev build-order race.                                                                                                                                                  |
| Env parsing       | `process.env` filtered to our own prefixes, then `strictObject`. Catches typos like `GOOGLE_CLIENT_IDD` without choking on PATH and TERM.                                                                                                                               |
| Message length    | Enforced in `ChatService` on the **trimmed** text, not by zod on the raw string. 520 chars plus trailing spaces is legal; a `.max()` on the raw value would reject it before the trim that makes it fit. Transport caps frame size instead (`maxHttpBufferSize`, 16kb). |
| No-payload events | Declared as `(...args: unknown[])` in `ClientToServerEvents`, not `() => void`. A zero-parameter listener never receives the value sent, so `queue:join` with a payload could not be detected — which is what `noPayloadSchema` exists for.                             |
| Composition       | `createChatServer()` in `server.ts` builds everything; `index.ts` is process concerns only. Makes the wiring itself testable, which is the part a hand-built test cannot reach.                                                                                         |
| Services emit     | Via an `Emitter` interface taking a `socketId`, never a `Socket`. Unit tests record emissions with no network. Per-socket not per-room because `chat:message` is asymmetric (`from: 'you'` vs `'stranger'`).                                                            |
| Errors            | Services throw one `ServiceError` carrying an `ErrorCode`. The transport has one catch block, so a new failure mode cannot be added without deciding what the client sees. Services never catch.                                                                        |
| Pairing           | Drain on every join/leave/skip, not on a timer, so a match happens on the arrival that made it possible. Head of queue pairs with the first entry of a different identity; same-identity tabs are skipped over, not blocked on.                                         |

## Deviations from AGENTS.md

Three, all forced by keeping auth in scope or by the contract being written
carefully. All approved.

1. Third store: `AuthSessionStore`.
2. Fifth client state: `unauthenticated`.
3. Message length is validated in `ChatService`, not by the zod schema. The rule
   is about the trimmed text, and zod cannot express "trim then measure".

Plus one version pin forced by the toolchain: TypeScript 5.9.3 instead of latest.

## Dependencies added beyond the AGENTS.md list

- `google-auth-library` — Google ID token verification. Approved.
- `@react-oauth/google` — Google sign-in button. **Not yet approved.**
- `socket.io-client` in `apps/server` devDeps — M2's two-client and acceptance tests need it.
- `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` — shadcn/ui primitives, still unused, land in M4.
- Tooling implied by spec: `tsup`, `tsx`, `vitest`, `eslint`, `prettier`, `typescript`, `zod`, `tailwindcss`, `postcss`, `autoprefixer`, `@types/node`, `@types/express`.

## M2 verification

| Check                                     | Result                                      |
| ----------------------------------------- | ------------------------------------------- |
| `pnpm typecheck`                          | pass (shared, server, web)                  |
| `pnpm lint`                               | pass                                        |
| `pnpm format:check`                       | pass                                        |
| `pnpm test`                               | pass, 98 tests across 7 files               |
| `pnpm -r build`                           | pass                                        |
| `pnpm dev`                                | pass, both up, Vite proxy reaches `/health` |
| `GET /health` against the running server  | `{"status":"ok",...}`                       |
| `POST /api/auth/google` with a fake token | 401 `invalid_credential`                    |
| `git diff -- frontend backend`            | empty                                       |

Test files:

| File                                             | Covers                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `stores/__tests__/queue-store.test.ts`           | FIFO order, removal, index integrity after a splice, snapshot isolation                                    |
| `stores/__tests__/session-store.test.ts`         | Lookups by socket and room, distinct room ids, index not cleared for a remapped socket                     |
| `services/__tests__/session-service.test.ts`     | The full state matrix asserted **against `allowedTransitions`**, pair and teardown, disconnect idempotence |
| `services/__tests__/matchmaking-service.test.ts` | FIFO pairing, no self-match, no same-identity match, double join, leave, skip, disconnect, stale ids       |
| `services/__tests__/chat-service.test.ts`        | Delivery and `from`, trimming, empty, length at and over the limit, sliding-window rate limit, typing      |
| `transport/__tests__/chat-flow.test.ts`          | Real sockets: full chat, payload rejection, illegal transitions, handshake refusals                        |
| `__tests__/acceptance.test.ts`                   | The real `createChatServer` composition, end to end                                                        |

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
