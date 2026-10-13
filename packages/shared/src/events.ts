import type { z } from 'zod'
import {
  ClientEvent,
  chatMessagePayloadSchema,
  chatTypingPayloadSchema,
  noPayloadSchema,
  type ChatMessageInbound,
  type ChatMessageOutbound,
  type ChatPartnerLeftReason,
  type ErrorCodeValue,
  type ErrorPayload,
  type MatchFoundPayload,
  type PresenceCountPayload,
} from './contract.js'

export type ClientEventValue = (typeof ClientEvent)[keyof typeof ClientEvent]

/** Typed Socket.IO contract. This is what gives us `socket.on` autocompletion. */
export interface ClientToServerEvents {
  [ClientEvent.queueJoin]: () => void
  [ClientEvent.queueLeave]: () => void
  [ClientEvent.chatMessage]: (payload: ChatMessageInbound) => void
  [ClientEvent.chatTyping]: (payload: { isTyping: boolean }) => void
  [ClientEvent.chatSkip]: () => void
  [ClientEvent.chatLeave]: () => void
}

export interface ServerToClientEvents {
  'queue:waiting': (payload: Record<string, never>) => void
  'match:found': (payload: MatchFoundPayload) => void
  'chat:message': (payload: ChatMessageOutbound) => void
  'chat:typing': (payload: { isTyping: boolean }) => void
  'chat:partner_left': (payload: { reason: ChatPartnerLeftReason }) => void
  'presence:count': (payload: PresenceCountPayload) => void
  error: (payload: ErrorPayload) => void
}

/**
 * Runtime schema per inbound event, so the transport can validate uniformly
 * without a switch statement that drifts out of sync with the event list.
 *
 * Note `queue:join` and friends are still present with `noPayloadSchema` rather
 * than omitted: omitting them would mean "unknown event" instead of "unexpected
 * payload", which is a much less useful error.
 */
export const clientEventSchema = {
  [ClientEvent.queueJoin]: noPayloadSchema,
  [ClientEvent.queueLeave]: noPayloadSchema,
  [ClientEvent.chatMessage]: chatMessagePayloadSchema,
  [ClientEvent.chatTyping]: chatTypingPayloadSchema,
  [ClientEvent.chatSkip]: noPayloadSchema,
  [ClientEvent.chatLeave]: noPayloadSchema,
} as const satisfies Record<ClientEventValue, z.ZodType>

export interface SocketData {
  /** Resolved during the handshake middleware. Never read before it runs. */
  identityId: string
  socketId: string
}

/**
 * Every server signal flattened into one discriminated union.
 *
 * The client registers each socket listener once in `lib/socket.ts` and funnels
 * them all through here, so the store handles them with a single exhaustive
 * `switch` instead of a separate callback per event. Adding an event to
 * `ServerToClientEvents` without adding it here is a compile error.
 */
export type ServerSignal =
  | { readonly type: 'connected' }
  | { readonly type: 'disconnected' }
  | {
      readonly type: 'connect_error'
      readonly payload: { readonly code: string; readonly message: string }
    }
  | { readonly type: 'queue:waiting'; readonly payload: Record<string, never> }
  | { readonly type: 'match:found'; readonly payload: MatchFoundPayload }
  | { readonly type: 'chat:message'; readonly payload: ChatMessageOutbound }
  | { readonly type: 'chat:typing'; readonly payload: { readonly isTyping: boolean } }
  | {
      readonly type: 'chat:partner_left'
      readonly payload: { readonly reason: ChatPartnerLeftReason }
    }
  | { readonly type: 'presence:count'; readonly payload: PresenceCountPayload }
  | { readonly type: 'error'; readonly payload: ErrorPayload }

export type { ErrorCodeValue, ChatMessageOutbound, ChatMessageInbound }
