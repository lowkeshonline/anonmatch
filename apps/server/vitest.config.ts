import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The two-client flow test binds real sockets. The default 5s is tight once
    // five of them share a process, and a flaky timeout reads as a product bug.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
