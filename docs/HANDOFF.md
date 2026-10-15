# Handoff

Done: AeroShards background on every screen except the radar (shell is `isolate`, mounted once above the screen switch); chat panel and Start pill frosted via `.glass`; send cooldown no longer blocks until the 5-per-3s window is full; status toast centered (`flex` beats `.pill`'s inline-flex so `mx-auto` applies).
Pending: eyeball shards, frosted panels, toast placement and cooldown in a real browser, light and dark — WebGPU and the ~520 kB bundle still unverified.
Failed: `browser` tool has no session tab; `apps/web` has no `lint` script, use root `pnpm eslint`.