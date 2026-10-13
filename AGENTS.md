# ROLE

You are a senior full-stack TypeScript engineer rebuilding "Chatwadi" from scratch in this repo. I'm Lokesh, a final-year MCA student. I know some React/Node and I'm learning TypeScript while building, so after each milestone give a short summary (max 5 bullets) of what you did and why.

# PRODUCT

Chatwadi is an anonymous random 1-on-1 text chat. A user opens the site, clicks Start, enters a matching queue, gets paired with another waiting stranger, and chats in real time. Either user can Skip (back to the queue) or Leave. No accounts in the MVP.

# WHY THE REBUILD

The old app (FastAPI + React) is in /legacy. It works, but the UI is poor and the code is poorly structured. Keep the same core behavior. Rebuild the structure and the UI. NEVER modify /legacy.

# STEP 0 (do this first, then STOP and wait for me to say "go")

1. Read /legacy (backend + frontend).
2. Write docs/legacy-contract.md covering: every websocket/HTTP event (name, direction, payload), how matching works, and edge cases it handles or fails to handle.
3. List legacy features worth keeping and ones to drop.
4. Show me a short summary. Do not start building until I reply "go".

# TECH STACK (fixed; ask before adding any dependency not listed)

- Monorepo with pnpm workspaces. TypeScript strict everywhere (strict, noUncheckedIndexedAccess, no `any`).
- apps/web: React 18 + Vite + TypeScript, Tailwind CSS, shadcn/ui (only components actually used), Zustand, socket.io-client.
- apps/server: Node 20 + Express + Socket.IO + TypeScript (tsx for dev, tsup for build).
- packages/shared: shared event types + zod schemas. This is the single source of truth for the contract.
- Validate EVERY incoming socket payload with zod.
- Tests: Vitest. Lint/format: ESLint + Prettier.
- No database in the MVP. Keep state in memory behind interfaces so Redis can replace it later.
- Docker: Dockerfile for the server. The web app is a static build.

# ARCHITECTURE RULES

Server layers:

- transport: socket handlers, thin. They parse and validate, call a service, and emit.
- services: MatchmakingService, SessionService (rooms/pairs), ChatService. They contain all business logic and never touch socket objects (use an Emitter interface), so they are unit-testable.
- stores: QueueStore and SessionStore interfaces, with InMemory implementations.

User state machine (server-authoritative): idle -> queued -> chatting -> ended -> (queued | idle). Illegal transitions return an `error` event and never crash the server.

Must handle:

- disconnect while queued
- disconnect while chatting (notify the partner)
- double queue:join
- skip, leave
- stale socket ids
- never match a user with themselves
- FIFO fairness
- message rate limit (5 msgs per 3s per socket)
- max message length 500 chars, trim, and drop empty messages

Skip semantics: the skipper goes straight back to the queue. The partner receives chat:partner_left and moves to `ended`.

# EVENT CONTRACT (define in packages/shared; change only if Step 0 shows a reason, and tell me)

Client -> server: queue:join, queue:leave, chat:message {text}, chat:typing {isTyping}, chat:skip, chat:leave
Server -> client: queue:waiting, match:found {roomId}, chat:message {id, text, from: 'you' | 'stranger', ts}, chat:typing {isTyping}, chat:partner_left, presence:count {online}, error {code, message}

# FRONTEND

Screens:

- Landing: Start button and online count.
- Searching: animated, with Cancel.
- Chat: message list, input, typing indicator, Skip/Next, Leave.
- Ended: "stranger left", with "Find new stranger".

Structure:

- src/features/{matchmaking,chat}
- src/components/ui
- src/lib/socket.ts (single socket instance)
- src/store (Zustand store mirrors the state machine: idle | searching | chatting | ended)

Components never call the socket directly. They call store actions.

Design (apply in M4; functionality first before that):

- minimal, modern, mobile-first (works at 360px)
- dark by default, with a light toggle
- one accent colour
- clear chat bubbles (mine right, stranger left)
- smooth transitions
- accessible: focus states, aria-live for new messages

# MILESTONES (STOP after each one and wait for my review)

M1 Scaffold: workspace, base tsconfig, ESLint/Prettier, shared schemas, server health route, web page that connects and shows online count. Accept: `pnpm dev` runs both and typecheck passes.
M2 Server core: stores, services, handlers, unit tests (FIFO pairing, no self-match, leave queue, disconnect cleanup, skip). Accept: vitest passes AND a scripted two-client socket.io-client test completes a full chat flow.
M3 Frontend functional: store, all four screens wired, plain styling. Accept: two browser tabs can match, chat, skip, leave, and handle a disconnect.
M4 UI polish: apply the design section. Accept: usable on mobile and desktop, dark and light.
M5 Hardening and delivery: reconnect handling, env-based CORS/URLs, Dockerfile, README with a mermaid architecture diagram, deploy notes (static host for web, Render/Fly for server).

# WORKING RULES

- Be token-efficient: small focused changes, don't re-read files you already know, no huge outputs, no long explanations.
- Commit after each milestone (conventional commits).
- Before ending a milestone run typecheck, lint, and tests, and report pass/fail.
- No TODO placeholders or fake implementations. If blocked, tell me.
- If a decision isn't covered here, ask me.
- Keep docs/PROGRESS.md short and current (done / next / decisions) so a fresh session can resume from it.
