import { randomUUID } from 'node:crypto'
import {
  ErrorCode,
  MAX_MESSAGE_LENGTH,
  RATE_LIMIT_MESSAGES,
  RATE_LIMIT_WINDOW_MS,
  ServerEvent,
} from '@anonmatch/shared'
import { ServiceError } from './service-error.js'
import type { Emitter } from './emitter.js'
import type { SessionService } from './session-service.js'
import type { SessionParticipant } from '../stores/session-store.js'

export interface ChatServiceDeps {
  readonly sessions: SessionService
  readonly emitter: Emitter
  readonly now: () => number
  /** Injected so message ids and timestamps are deterministic under test. */
  readonly newId?: () => string
}

/**
 * Message delivery, text rules, and the send rate limit.
 *
 * Order matters here and is deliberate. The rate limit is checked first so a
 * client spamming empty or oversized messages still burns quota; checking it last
 * would let a flood of invalid messages consume unbounded work.
 */
export class ChatService {
  readonly #sessions: SessionService
  readonly #emitter: Emitter
  readonly #now: () => number
  readonly #newId: () => string
  /** socketId -> timestamps of sends still inside the window. */
  readonly #recentSends = new Map<string, number[]>()

  constructor(deps: ChatServiceDeps) {
    this.#sessions = deps.sessions
    this.#emitter = deps.emitter
    this.#now = deps.now
    this.#newId = deps.newId ?? randomUUID
  }

  /** `chat:message`. Throws on not-in-chat, rate limited, empty or too long. */
  send(socketId: string, text: string): void {
    const partner = this.#partnerOrThrow(socketId)

    this.#consumeQuota(socketId)

    const trimmed = text.trim()
    if (trimmed === '') {
      throw new ServiceError(ErrorCode.messageEmpty, 'Message cannot be empty.')
    }
    // Checked after trimming, so 520 characters of prose plus trailing spaces is
    // measured on what will actually be shown, not on what was typed.
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new ServiceError(
        ErrorCode.messageTooLong,
        `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`,
      )
    }

    const id = this.#newId()
    const ts = this.#now()

    // One message, two deliveries. The ids and timestamps are identical so the
    // client can reconcile its own optimistic copy, and `from` differs so the
    // bubble lands on the right side without the client guessing.
    this.#emitter.to(socketId, ServerEvent.chatMessage, { id, text: trimmed, from: 'you', ts })
    this.#emitter.to(partner.socketId, ServerEvent.chatMessage, {
      id,
      text: trimmed,
      from: 'stranger',
      ts,
    })
  }

  /**
   * `chat:typing`. Forwarded to the partner only.
   *
   * Not rate limited. A client fires this on every keystroke, so a send limit
   * here would break the indicator for fast typists, and the event carries no
   * text and no allocation.
   */
  typing(socketId: string, isTyping: boolean): void {
    const partner = this.#partnerOrThrow(socketId)
    this.#emitter.to(partner.socketId, ServerEvent.chatTyping, { isTyping })
  }

  /** Drops the sender's quota. Called on disconnect so the map cannot grow forever. */
  forget(socketId: string): void {
    this.#recentSends.delete(socketId)
  }

  #partnerOrThrow(socketId: string): SessionParticipant {
    const partner = this.#sessions.partnerOf(socketId)
    if (partner === null) {
      throw new ServiceError(ErrorCode.notInChat, 'You are not in a chat.')
    }
    return partner
  }

  /**
   * Sliding window over the last `RATE_LIMIT_WINDOW_MS`, capped at
   * `RATE_LIMIT_MESSAGES` sends.
   *
   * Sliding rather than fixed, because a fixed window lets a client send 2x the
   * limit across a boundary by bursting either side of the tick. The window is
   * stored per socket, so one person flooding cannot lock out their partner.
   */
  #consumeQuota(socketId: string): void {
    const now = this.#now()
    const cutoff = now - RATE_LIMIT_WINDOW_MS
    const recent = (this.#recentSends.get(socketId) ?? []).filter((at) => at > cutoff)

    if (recent.length >= RATE_LIMIT_MESSAGES) {
      // Persist the pruned window even on rejection, otherwise a rejected send
      // would not advance the window and the client could retry forever.
      this.#recentSends.set(socketId, recent)
      throw new ServiceError(
        ErrorCode.rateLimited,
        `Slow down. You can send ${RATE_LIMIT_MESSAGES} messages every 3 seconds.`,
      )
    }

    recent.push(now)
    this.#recentSends.set(socketId, recent)
  }
}
