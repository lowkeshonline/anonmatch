import { io, type Socket } from 'socket.io-client'
import {
  ErrorCode,
  ServerEvent,
  type ClientToServerEvents,
  type ServerSignal,
  type ServerToClientEvents,
} from '@chatwadi/shared'

export type ChatClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>

type Listener = (signal: ServerSignal) => void

let socket: ChatClientSocket | null = null
let listener: Listener | null = null

/**
 * Single socket instance for the whole app, per the architecture rules. The
 * listener is registered once at creation so every signal lands in one place.
 */
function dispatch(signal: ServerSignal): void {
  listener?.(signal)
}

function registerHandlers(target: ChatClientSocket): void {
  target.on('connect', () => dispatch({ type: 'connected' }))
  target.on('disconnect', () => dispatch({ type: 'disconnected' }))

  // `connect_error` is a socket-level reserved event in socket.io-client v4,
  // not a manager event. `err.data` is typed `any`, so it is coerced to
  // `unknown` before being inspected.
  target.on('connect_error', (error) => {
    const data: unknown = error.data
    const code =
      typeof data === 'object' && data !== null && 'code' in data && typeof data.code === 'string'
        ? data.code
        : ErrorCode.internal
    dispatch({ type: 'connect_error', payload: { code, message: error.message } })
  })

  target.on(ServerEvent.queueWaiting, (payload) => dispatch({ type: 'queue:waiting', payload }))
  target.on(ServerEvent.matchFound, (payload) => dispatch({ type: 'match:found', payload }))
  target.on(ServerEvent.chatMessage, (payload) => dispatch({ type: 'chat:message', payload }))
  target.on(ServerEvent.chatTyping, (payload) => dispatch({ type: 'chat:typing', payload }))
  target.on(ServerEvent.chatPartnerLeft, (payload) =>
    dispatch({ type: 'chat:partner_left', payload }),
  )
  target.on(ServerEvent.presenceCount, (payload) => dispatch({ type: 'presence:count', payload }))
  target.on(ServerEvent.error, (payload) => dispatch({ type: 'error', payload }))
}

/**
 * Opens (or returns) the shared socket.
 *
 * `auth` is passed as a callback, not an object, so Socket.IO re-reads the token
 * on every connection attempt including automatic reconnects. M5 depends on
 * that; passing a plain object would pin the token from first connect forever.
 */
export function connectSocket(token: string, onSignal: Listener): ChatClientSocket {
  listener = onSignal

  if (socket !== null) return socket

  socket = io({
    auth: (callback: (credentials: { token: string }) => void) => callback({ token }),
    autoConnect: true,
    transports: ['websocket', 'polling'],
  })

  registerHandlers(socket)
  return socket
}

export function disconnectSocket(): void {
  socket?.disconnect()
  socket = null
  listener = null
}
