import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  // The shared package ships TypeScript source, so it must be compiled in.
  noExternal: ['@chatwadi/shared'],
})
