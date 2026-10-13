import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const API_TARGET = process.env['VITE_SERVER_URL'] ?? 'http://localhost:4000'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    // @chatwadi/shared ships TypeScript source for monorepo typechecking, so it
    // must not be pre-bundled as a compiled dep.
    exclude: ['@chatwadi/shared'],
  },
  server: {
    port: 5173,
    // One origin in dev: the browser talks to /api and /socket.io on the Vite
    // port, and Vite forwards both. No CORS preflight, no second origin to
    // keep in sync on the server allowlist.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/socket.io': { target: API_TARGET, ws: true, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
    },
  },
})
