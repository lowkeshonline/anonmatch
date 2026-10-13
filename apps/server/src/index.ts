import { createServer } from 'node:http'
import { config, isEmailAllowed } from './config.js'
import { AuthService } from './services/auth-service.js'
import { InMemoryAuthSessionStore } from './stores/auth-session-store.js'
import { InMemoryPresenceStore } from './stores/presence-store.js'
import { createHttpApp } from './transport/http.js'
import { createSocketServer } from './transport/socket.js'

const authService = new AuthService({
  googleClientId: config.googleClientId,
  isEmailAllowed,
})
const authSessions = new InMemoryAuthSessionStore(config.sessionTtlMs)
const presence = new InMemoryPresenceStore()

const app = createHttpApp({ config, authService, authSessions })
const httpServer = createServer(app)
const io = createSocketServer(httpServer, { config, authSessions, presence })

const shutdown = (signal: string) => {
  console.warn(`\n${signal} received, shutting down.`)
  void io.close()
  httpServer.close(() => process.exit(0))
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 5_000).unref()
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

/**
 * A real Google client ID looks like `1234567890-abc.apps.googleusercontent.com`.
 * Anything else is almost certainly a placeholder left in .env, which fails at
 * the first sign-in with an opaque "Wrong recipient" error from Google. Warned
 * rather than fatal: the ID is public (it ships in the browser bundle), so a
 * valid-but-unusual value must not be locked out.
 */
const GOOGLE_CLIENT_ID_SHAPE = /^\d{6,}-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/

httpServer.listen(config.port, config.host, () => {
  console.warn(`chatwadi server listening on http://${config.host}:${config.port} (${config.env})`)
  console.warn(`cors origins: ${config.corsOrigins.join(', ')}`)
  console.warn(`google client id: ${config.googleClientId}`)

  if (!GOOGLE_CLIENT_ID_SHAPE.test(config.googleClientId)) {
    console.warn(
      [
        '',
        '  WARNING: GOOGLE_CLIENT_ID does not look like a Google OAuth client ID.',
        '    got:      ' + config.googleClientId,
        '    expected: 1234567890-abc.apps.googleusercontent.com',
        '    Sign-in will fail until this matches VITE_GOOGLE_CLIENT_ID in apps/web/.env.',
        '    (Both values must come from the same Google Cloud OAuth client.)',
        '',
      ].join('\n'),
    )
  }
})
