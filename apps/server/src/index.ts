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

httpServer.listen(config.port, config.host, () => {
  console.warn(`chatwadi server listening on http://${config.host}:${config.port} (${config.env})`)
  console.warn(`cors origins: ${config.corsOrigins.join(', ')}`)
})
