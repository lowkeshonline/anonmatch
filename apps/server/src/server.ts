import { createServer, type Server as HttpServer } from 'node:http'
import type { Express } from 'express'
import type { Config } from './config.js'
import type { AuthService } from './services/auth-service.js'
import { ChatService } from './services/chat-service.js'
import { MatchmakingService } from './services/matchmaking-service.js'
import { SessionService } from './services/session-service.js'
import { InMemoryAuthSessionStore } from './stores/auth-session-store.js'
import { InMemoryPresenceStore } from './stores/presence-store.js'
import { InMemoryQueueStore } from './stores/queue-store.js'
import { InMemorySessionStore } from './stores/session-store.js'
import { createHttpApp } from './transport/http.js'
import { createSocketServer, type ChatServer } from './transport/socket.js'
import { SocketEmitter } from './transport/socket-emitter.js'

export interface ChatServerApp {
  readonly httpApp: Express
  readonly httpServer: HttpServer
  readonly io: ChatServer
  /** Exposed so tests can mint a session without going through Google. */
  readonly authSessions: InMemoryAuthSessionStore
  /** Listens on `port`, or on a free port when `port` is 0. Resolves the port. */
  listen(): Promise<number>
  /** Stops the background prune timer. Called from graceful shutdown. */
  stopPruning(): void
  close(): Promise<void>
}

export interface ChatServerDeps {
  readonly config: Config
  readonly authService: AuthService
  /** Injected so message ids and timestamps are deterministic under test. */
  readonly now?: () => number
}

/**
 * Builds the whole server: HTTP, Socket.IO, the stores and the service graph.
 *
 * This exists so `index.ts` contains only process concerns (listen, signals, the
 * boot log) and so the wiring itself is reachable from a test. When the
 * composition lived only in `index.ts`, the one thing no test could check was
 * whether the stores and services were actually connected to each other.
 */
export function createChatServer(deps: ChatServerDeps): ChatServerApp {
  const { config, authService } = deps
  const now = deps.now ?? (() => Date.now())

  const authSessions = new InMemoryAuthSessionStore(config.sessionTtlMs)
  const presence = new InMemoryPresenceStore()
  const queue = new InMemoryQueueStore()
  const chatSessions = new InMemorySessionStore()

  /**
   * Services are built before Socket.IO exists but need somewhere to emit, so
   * the emitter is bound to the real server inside `createSocketServer`.
   */
  const emitter = new SocketEmitter()

  const sessions = new SessionService({ store: chatSessions, emitter, now })
  const matchmaking = new MatchmakingService({ queue, sessions, emitter, now })
  const chats = new ChatService({ sessions, emitter, now })

  const httpApp = createHttpApp({ config, authService, authSessions })
  const httpServer = createServer(httpApp)
  const io = createSocketServer(httpServer, {
    config,
    authSessions,
    presence,
    matchmaking,
    sessions,
    chats,
    emitter,
  })

  /**
   * Expired tokens are only removed lazily on lookup, so without this the
   * token -> identity map would grow for the life of the process. `unref()` so
   * the timer never holds the process open.
   */
  const pruneTimer = setInterval(() => authSessions.prune(now()), 60_000)
  pruneTimer.unref()

  return {
    httpApp,
    httpServer,
    io,
    authSessions,
    stopPruning: () => clearInterval(pruneTimer),
    listen: () =>
      new Promise<number>((resolve, reject) => {
        httpServer.once('error', reject)
        httpServer.listen(config.port, config.host, () => {
          const address = httpServer.address()
          if (address === null || typeof address === 'string') {
            reject(new Error('server did not bind a TCP port'))
            return
          }
          resolve(address.port)
        })
      }),
    close: () =>
      new Promise<void>((resolve) => {
        void io.close(() => {
          void httpServer.close(() => resolve())
        })
      }),
  }
}
