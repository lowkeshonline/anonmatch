import type { Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import {
  ErrorCode,
  ServerEvent,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from '@anonmatch/shared'
import type { Config } from '../config.js'
import type { AuthSessionStore } from '../stores/auth-session-store.js'
import type { PresenceStore } from '../stores/presence-store.js'
import type { ChatService } from '../services/chat-service.js'
import type { MatchmakingService } from '../services/matchmaking-service.js'
import type { SessionService } from '../services/session-service.js'
import { registerChatHandlers } from './chat-handlers.js'
import type { SocketEmitter } from './socket-emitter.js'

export type ChatServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>
export type ChatSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>

/**
 * Socket.IO delivers middleware failures as a `connect_error` on the client.
 * `data` is the documented channel for structured detail, so the client can
 * branch on a code instead of matching on an error string.
 */
class HandshakeError extends Error {
  readonly data: { code: string }

  constructor(message: string, code: string) {
    super(message)
    this.name = 'HandshakeError'
    this.data = { code }
  }
}

/**
 * `socket.handshake.auth` is untrusted input. Read it defensively rather than
 * casting, so a client sending `auth: {token: 42}` or `auth: "nope"` gets a
 * clean rejection instead of a crash in the middleware.
 */
function readHandshakeToken(handshakeAuth: unknown): string | null {
  if (typeof handshakeAuth !== 'object' || handshakeAuth === null) return null
  if (!('token' in handshakeAuth)) return null
  const value: unknown = handshakeAuth.token
  return typeof value === 'string' && value !== '' ? value : null
}

export interface SocketDeps {
  readonly config: Config
  readonly authSessions: AuthSessionStore
  readonly presence: PresenceStore
  readonly matchmaking: MatchmakingService
  readonly sessions: SessionService
  readonly chats: ChatService
  readonly emitter: SocketEmitter
}

export function createSocketServer(httpServer: HttpServer, deps: SocketDeps): ChatServer {
  const { config, authSessions, presence, matchmaking, sessions, chats, emitter } = deps

  const io: ChatServer = new Server(httpServer, {
    cors: {
      origin: config.corsOrigins,
      methods: ['GET', 'POST'],
    },
    /**
     * 16kb. The only inbound payload is a message of at most 500 characters, so
     * this is generous by two orders of magnitude while still capping what a
     * single frame can cost the server. It is what makes it safe for
     * `chatMessagePayloadSchema` to impose no length bound of its own.
     */
    maxHttpBufferSize: 16 * 1024,
  })

  emitter.bind(io)

  /**
   * Runs before any connection handler, so `socket.data.identityId` is
   * guaranteed to be set for everything downstream. Nothing else in the server
   * reads the handshake.
   */
  io.use((socket, next) => {
    const token = readHandshakeToken(socket.handshake.auth)
    if (token === null) {
      next(new HandshakeError('Not authenticated', ErrorCode.notAuthenticated))
      return
    }

    const identity = authSessions.find(token, Date.now())
    if (identity === null) {
      next(new HandshakeError('Session expired or invalid', ErrorCode.notAuthenticated))
      return
    }

    socket.data.identityId = identity.id
    socket.data.socketId = socket.id
    next()
  })

  io.on('connection', (socket: ChatSocket) => {
    const identityId = socket.data.identityId

    sessions.register(socket.id, identityId)
    registerChatHandlers(socket, { matchmaking, sessions, chats })

    io.emit(ServerEvent.presenceCount, { online: presence.add(socket.id, identityId) })

    socket.on('disconnect', () => {
      /**
       * Order is load-bearing. The pair has to be torn down and the partner told
       * before the presence count drops, or the partner sees "0 online" before
       * they are told their chat ended. `handleDisconnect` covers both the
       * queued and the chatting case; `forget` drops the rate-limit window,
       * without which the socketId map would grow for the life of the process.
       */
      matchmaking.handleDisconnect(socket.id)
      chats.forget(socket.id)

      io.emit(ServerEvent.presenceCount, { online: presence.remove(socket.id) })
    })
  })

  return io
}
