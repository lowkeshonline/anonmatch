# Codebase map (Anonmatch)

pnpm monorepo. Anonymous 1-on-1 chat.

- packages/shared/src: contract.ts (events, ErrorCode, Zod schemas, state machine), events.ts, index.ts. Source of truth; change here first.
- apps/server/src: server.ts (composition root), config.ts, services/ (matchmaking, session, chat, auth), stores/ (in-memory only), transport/ (Socket.IO, HTTP, CORS).
- apps/web/src: App.tsx (routing on store status), store/app-store.ts (Zustand, maps ServerSignals), lib/socket.ts (singleton), features/ (auth, landing, searching, chat, ended).
- apps/web: locked theme tokens in tailwind.config.ts and index.css (referenced docs/design.md is absent); index.css also holds the component classes (.screen-main, .bubble, .composer-input, .send-btn, .jump-latest, .glass = translucent + backdrop-blur panel tinted with `--c-bg` at partial alpha).
- apps/web/src/components: vendored untyped `.jsx` registry items with hand-written `.d.ts` (Radar, StarBorder — the Start button, AeroShards — the background). `AmbientBackground.tsx` mounts AeroShards (WebGPU via `vgpu`, prop set from react-bits) full-bleed; App mounts it once for the whole session on every screen except searching, and takes `lightMode` from `useTheme`. The App shell needs `isolate`: without a stacking context its `bg-bg` would paint over the `-z-10` layers. When WebGPU is missing it renders nothing, leaving the plain themed surface.
- App.tsx wraps the four screens in one `key={status}` element with `animate-fade`, so every screen change remounts and replays the transition; the wrapper's flex classes are the shell's, so screens keep their flex parent.
- apps/web chat transcript: MessageList pins to the newest message only while the reader is already at the bottom (stuckRef) and offers a "Jump to latest" pill otherwise; each bubble carries an `sr-only` `<time>` so the stamp is not hover-only.
- apps/web tests: vitest + jsdom, app-store state machine only; no component-render tests.
- README.md + .github/workflows/ci.yml: root docs and CI (typecheck/lint/test/build). vercel.json serves apps/web/dist; the realtime server deploys separately as an always-on service.
