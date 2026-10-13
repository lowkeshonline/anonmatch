import { z } from 'zod'

/**
 * Limits from the spec. Both are enforced server-side; the client uses them for
 * inline feedback so the user is never told "too long" only after the fact.
 */
export const MAX_MESSAGE_LENGTH = 500
export const RATE_LIMIT_MESSAGES = 5
export const RATE_LIMIT_WINDOW_MS = 3_000

/**
 * Events the client sends. Every one of these is validated with zod at the
 * transport boundary before any service sees it.
 */
export const ClientEvent = {
  queueJoin: 'queue:join',
  queueLeave: 'queue:leave',
  chatMessage: 'chat:message',
  chatTyping: 'chat:typing',
  chatSkip: 'chat:skip',
  chatLeave: 'chat:leave',
} as const

/** Events the server sends. */
export const ServerEvent = {
  queueWaiting: 'queue:waiting',
  matchFound: 'match:found',
  chatMessage: 'chat:message',
  chatTyping: 'chat:typing',
  chatPartnerLeft: 'chat:partner_left',
  presenceCount: 'presence:count',
  error: 'error',
} as const

/**
 * Stable codes so the client can branch on `error.code` instead of matching on
 * human-readable copy. Never show `message` as the sole signal for behaviour.
 */
export const ErrorCode = {
  notAuthenticated: 'NOT_AUTHENTICATED',
  invalidPayload: 'INVALID_PAYLOAD',
  illegalTransition: 'ILLEGAL_TRANSITION',
  alreadyQueued: 'ALREADY_QUEUED',
  notInChat: 'NOT_IN_CHAT',
  rateLimited: 'RATE_LIMITED',
  messageTooLong: 'MESSAGE_TOO_LONG',
  messageEmpty: 'MESSAGE_EMPTY',
  internal: 'INTERNAL',
} as const

export const errorCodeSchema = z.enum(ErrorCode)
export type ErrorCodeValue = z.infer<typeof errorCodeSchema>

/**
 * For events that take no payload. Optional so `socket.emit('chat:skip')`
 * validates, but still `strictObject` so `socket.emit('chat:skip', {x: 1})`
 * is rejected rather than silently ignored.
 */
export const noPayloadSchema = z.strictObject({}).optional()

/**
 * The server-authoritative lifecycle. `ended` is a resting state the client
 * leaves via `queue:join` (back to the queue) or by disconnecting (back to
 * `idle`). Services are the only place allowed to decide a transition.
 */
export const userStateSchema = z.enum(['idle', 'queued', 'chatting', 'ended'])
export type UserState = z.infer<typeof userStateSchema>

/**
 * Which state each event is legal from. Services consult this rather than
 * re-deriving the rules, so the contract lives in exactly one place.
 */
export const allowedTransitions: Readonly<Record<UserState, readonly UserState[]>> = {
  idle: ['queued'],
  queued: ['idle', 'chatting'],
  chatting: ['ended', 'queued'],
  ended: ['queued', 'idle'],
}

// --- Client -> Server payloads -------------------------------------------

/**
 * The real limit is applied in `ChatService`, not here, and the difference is
 * not cosmetic: the rule is that the *trimmed* text is at most
 * `MAX_MESSAGE_LENGTH`, so 520 characters of prose followed by trailing spaces
 * is legal. A `.max()` on the raw string would reject it before the trim that
 * makes it fit, and would report the wrong limit for the same reason.
 *
 * Leaving the bound off means this schema accepts arbitrarily long strings, so
 * the transport caps frame size instead (`maxHttpBufferSize` in the Socket.IO
 * server). 16kb against a 500 character limit is two orders of magnitude of
 * headroom, and it means one rule owns the limit rather than two disagreeing.
 */
export const chatMessagePayloadSchema = z.strictObject({
  text: z.string(),
})

export const chatTypingPayloadSchema = z.strictObject({
  isTyping: z.boolean(),
})

// --- Server -> Client payloads -------------------------------------------

export const queueWaitingPayloadSchema = z.strictObject({})

export const matchFoundPayloadSchema = z.strictObject({
  roomId: z.string().min(1),
})

/**
 * `from` is relative to whoever receives it: the sender gets `'you'`, the
 * partner gets `'stranger'`. That is why the server emits per socket rather
 * than broadcasting to a room.
 */
export const chatMessageFromSchema = z.enum(['you', 'stranger'])

export const chatMessagePayloadOutboundSchema = z.strictObject({
  id: z.string().min(1),
  text: z.string(),
  from: chatMessageFromSchema,
  ts: z.number().int().nonnegative(),
})

export const chatTypingPayloadOutboundSchema = z.strictObject({
  isTyping: z.boolean(),
})

/**
 * Declared on its own and then composed into the payload, rather than inferred
 * back out of the payload.
 *
 * M1 inferred `ChatPartnerLeftReason` from `chatPartnerLeftPayloadSchema`, which
 * makes it the whole `{ reason }` object, not the reason. Nothing caught it
 * because the type only ever appeared inside a declared payload shape that no
 * value was ever checked against. Deriving it the other way round means the
 * field and the type cannot drift apart again.
 */
export const chatPartnerLeftReasonSchema = z.enum(['skipped', 'left', 'disconnected'])

export const chatPartnerLeftPayloadSchema = z.strictObject({
  reason: chatPartnerLeftReasonSchema,
})

export const presenceCountPayloadSchema = z.strictObject({
  online: z.number().int().nonnegative(),
})

export const errorPayloadSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string(),
})

// --- Identity -------------------------------------------------------------

/**
 * Server-internal. Never serialised to a peer. The legacy app leaked peer
 * emails in four different events; this type is not reachable from any
 * outbound payload on purpose.
 */
export const identitySchema = z.strictObject({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string(),
  picture: z.string().nullable(),
})
export type Identity = z.infer<typeof identitySchema>

/**
 * The view of the signed-in user. Safe to hand to the client it belongs to.
 * `picture` is a Google avatar URL, not identity data about anyone else.
 */
export const currentUserSchema = identitySchema
export type CurrentUser = z.infer<typeof currentUserSchema>

export type ChatMessageInbound = z.infer<typeof chatMessagePayloadSchema>
export type ChatMessageOutbound = z.infer<typeof chatMessagePayloadOutboundSchema>
export type MatchFoundPayload = z.infer<typeof matchFoundPayloadSchema>
export type PresenceCountPayload = z.infer<typeof presenceCountPayloadSchema>
export type ErrorPayload = z.infer<typeof errorPayloadSchema>
export type ChatPartnerLeftReason = z.infer<typeof chatPartnerLeftReasonSchema>
