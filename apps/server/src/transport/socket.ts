import type { Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import {
  ErrorCode,
  ServerEvent,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from '@chatwadi/shared'
import type { Config } from '../config.js'
import type { AuthSessionStore } from '../stores/auth-session-store.js'
import type { PresenceStore } from '../stores/presence-store.js'

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
}

export function createSocketServer(httpServer: HttpServer, deps: SocketDeps): ChatServer {
  const { config, authSessions, presence } = deps

  const io: ChatServer = new Server(httpServer, {
    cors: {
      origin: config.corsOrigins,
      methods: ['GET', 'POST'],
    },
  })

  /**
   * Runs before any connection handler, so `socket.data.identityId` is
   * guaranteed to be set for everything downstream. M2 wires the chat handlers
   * behind this same middleware.
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
    const online = presence.add(socket.id, socket.data.identityId)
    io.emit(ServerEvent.presenceCount, { online })

    socket.on('disconnect', () => {
      io.emit(ServerEvent.presenceCount, { online: presence.remove(socket.id) })
    })
  })

  return io
}
