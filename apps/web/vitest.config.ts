import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // jsdom, not node: the store reads `window.localStorage` and creates local
    // ids through `crypto.randomUUID`, both of which the app gets for free in a
    // browser and has to be given one in a test.
    environment: 'jsdom',
  },
})
