import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    /**
     * `src/config.ts` validates GOOGLE_CLIENT_ID at import time and exits the
     * process when it is missing. A developer's gitignored `apps/server/.env`
     * hid that locally, but CI has no `.env` and the acceptance test — which
     * imports the real composition in `server.ts` — killed the run. Tests never
     * talk to Google, so a stub keeps them independent of local setup.
     */
    env: {
      GOOGLE_CLIENT_ID: '000000000000-test.apps.googleusercontent.com',
    },
    // The two-client flow test binds real sockets. The default 5s is tight once
    // five of them share a process, and a flaky timeout reads as a product bug.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
