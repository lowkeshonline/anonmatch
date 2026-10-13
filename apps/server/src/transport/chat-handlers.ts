import type { z } from 'zod'
import {
  ClientEvent,
  ErrorCode,
  ServerEvent,
  clientEventSchema,
  type ClientToServerEvents,
} from '@anonmatch/shared'
import { isServiceError } from '../services/service-error.js'
import type { ChatService } from '../services/chat-service.js'
import type { MatchmakingService } from '../services/matchmaking-service.js'
import type { SessionService } from '../services/session-service.js'
import type { ChatSocket } from './socket.js'

type ClientEventName = keyof ClientToServerEvents
type Inbound<E extends ClientEventName> = z.infer<(typeof clientEventSchema)[E]>

export interface ChatHandlerDeps {
  readonly matchmaking: MatchmakingService
  readonly sessions: SessionService
  readonly chats: ChatService
}

/**
 * First zod issue as a single sentence.
 *
 * Only the first issue is shown. A client that gets a list of everything wrong
 * with a request it built from a single field learns nothing from the other four.
 */
function describeIssues(error: z.ZodError): string {
  const issue = error.issues[0]
  if (issue === undefined) return 'Invalid payload.'
  return issue.message
}

/**
 * Validate, dispatch, convert failures into an `error` event.
 *
 * The three failure modes are kept distinct on purpose:
 *
 * 1. A payload that does not match the contract is `INVALID_PAYLOAD`. The
 *    client sent something we cannot read.
 * 2. A legal payload that the state machine rejects is a `ServiceError`, whose
 *    code is the specific reason. The client sent something we can read but it
 *    is not allowed right now.
 * 3. Anything else is ours. It is logged with the socket id and the client gets
 *    a generic `INTERNAL`, because no handler may be allowed to take the process
 *    down. A thrown error in a Socket.IO callback would otherwise be an
 *    unhandled rejection.
 */
function dispatch<E extends ClientEventName>(
  socket: ChatSocket,
  event: E,
  raw: unknown,
  run: (payload: Inbound<E>) => void,
): void {
  const parsed = clientEventSchema[event].safeParse(raw)

  if (!parsed.success) {
    socket.emit(ServerEvent.error, {
      code: ErrorCode.invalidPayload,
      message: describeIssues(parsed.error),
    })
    return
  }

  try {
    run(parsed.data as Inbound<E>)
  } catch (error) {
    if (isServiceError(error)) {
      socket.emit(ServerEvent.error, { code: error.code, message: error.message })
      return
    }

    console.error(`unhandled error in ${event} for socket ${socket.id}`, error)
    socket.emit(ServerEvent.error, {
      code: ErrorCode.internal,
      message: 'Something went wrong. Please try again.',
    })
  }
}

/**
 * Registers the six client events. Thin by design: parse, call a service, report.
 *
 * Every business rule lives in a service, so this file is the only place that
 * knows how an `Emitter` and a service call are glued to an event name.
 */
export function registerChatHandlers(socket: ChatSocket, deps: ChatHandlerDeps): void {
  const { matchmaking, sessions, chats } = deps
  const socketId = socket.id

  socket.on(ClientEvent.queueJoin, (payload) => {
    dispatch(socket, ClientEvent.queueJoin, payload, () => matchmaking.join(socketId))
  })

  socket.on(ClientEvent.queueLeave, (payload) => {
    dispatch(socket, ClientEvent.queueLeave, payload, () => matchmaking.leave(socketId))
  })

  socket.on(ClientEvent.chatMessage, (payload) => {
    dispatch(socket, ClientEvent.chatMessage, payload, (p) => chats.send(socketId, p.text))
  })

  socket.on(ClientEvent.chatTyping, (payload) => {
    dispatch(socket, ClientEvent.chatTyping, payload, (p) => chats.typing(socketId, p.isTyping))
  })

  socket.on(ClientEvent.chatSkip, (payload) => {
    dispatch(socket, ClientEvent.chatSkip, payload, () => matchmaking.skip(socketId))
  })

  socket.on(ClientEvent.chatLeave, (payload) => {
    dispatch(socket, ClientEvent.chatLeave, payload, () => sessions.leaveChat(socketId))
  })
}
