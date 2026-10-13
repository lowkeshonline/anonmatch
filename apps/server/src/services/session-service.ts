import {
  ErrorCode,
  ServerEvent,
  allowedTransitions,
  type ChatPartnerLeftReason,
  type UserState,
} from '@anonmatch/shared'
import { ServiceError } from './service-error.js'
import type { Emitter } from './emitter.js'
import type { SessionParticipant, SessionStore, UserRecord } from '../stores/session-store.js'

export interface SessionServiceDeps {
  readonly store: SessionStore
  readonly emitter: Emitter
  /** Injected so room ids and timestamps are deterministic under test. */
  readonly now: () => number
}

/**
 * The state machine and chat-pair lifecycle.
 *
 * The only place allowed to decide that a transition is legal. It reads
 * `allowedTransitions` from the shared contract rather than restating the rules,
 * so the contract stays the single source of truth and a client and server
 * disagreement is a type error rather than a bug found in production.
 *
 * Every method that can fail throws `ServiceError`. Nothing here catches, so an
 * illegal action can never leave half-applied state: the transport converts the
 * throw into an `error` event and moves on.
 */
export class SessionService {
  readonly #store: SessionStore
  readonly #emitter: Emitter
  readonly #now: () => number

  constructor(deps: SessionServiceDeps) {
    this.#store = deps.store
    this.#emitter = deps.emitter
    this.#now = deps.now
  }

  /**
   * Called once per connection, after the handshake resolves an identity.
   * Presence of a record is what makes a socket id "known": anything arriving
   * for an unregistered id is stale and is rejected rather than crashing.
   */
  register(socketId: string, identityId: string): UserRecord {
    return this.#store.registerUser(socketId, identityId)
  }

  stateOf(socketId: string): UserState | null {
    return this.#store.getUser(socketId)?.state ?? null
  }

  /** Like `stateOf` but throws, for call sites that cannot proceed without one. */
  requireUser(socketId: string): UserRecord {
    const user = this.#store.getUser(socketId)
    if (user === null) {
      throw new ServiceError(ErrorCode.notAuthenticated, 'This session is no longer active.')
    }
    return user
  }

  /**
   * Moves a socket to a new state, refusing anything the contract disallows.
   *
   * Refusing rather than clamping is deliberate: a silently ignored transition
   * shows up as a button that "does nothing", whereas `ILLEGAL_TRANSITION` says
   * the client is out of sync and can resync.
   */
  transition(socketId: string, to: UserState, roomId: string | null): void {
    const user = this.requireUser(socketId)
    const allowed = allowedTransitions[user.state]

    if (!allowed.includes(to)) {
      throw new ServiceError(
        ErrorCode.illegalTransition,
        `You cannot go from ${user.state} to ${to}.`,
      )
    }

    this.#store.setUserState(socketId, to, roomId)
  }

  /**
   * Creates the room, moves both sides to `chatting`, and tells each side it
   * matched.
   *
   * Both checks run before any mutation so a rejected pair leaves the queue
   * untouched and no half-made room is left behind.
   */
  pair(a: SessionParticipant, b: SessionParticipant): void {
    const userA = this.requireUser(a.socketId)
    const userB = this.requireUser(b.socketId)

    if (userA.state !== 'queued' || userB.state !== 'queued') {
      throw new ServiceError(
        ErrorCode.illegalTransition,
        'Both people must be waiting in the queue to be matched.',
      )
    }

    const session = this.#store.createSession(a, b, this.#now())
    this.#store.setUserState(a.socketId, 'chatting', session.roomId)
    this.#store.setUserState(b.socketId, 'chatting', session.roomId)

    this.#emitter.to(a.socketId, ServerEvent.matchFound, { roomId: session.roomId })
    this.#emitter.to(b.socketId, ServerEvent.matchFound, { roomId: session.roomId })
  }

  /** The other person in this socket's room, or null if it is not in a chat. */
  partnerOf(socketId: string): SessionParticipant | null {
    const session = this.#store.findSessionBySocket(socketId)
    if (session === null) return null
    if (session.a.socketId === socketId) return session.b
    if (session.b.socketId === socketId) return session.a
    return null
  }

  roomOf(socketId: string): string | null {
    return this.#store.getUser(socketId)?.roomId ?? null
  }

  /**
   * Tears down a room. Everyone in it lands in `ended`; `exceptSocketId` is the
   * person who caused it and is therefore not told.
   *
   * Not telling the skipper matters. They asked for this, and a `partner_left`
   * would flash "stranger left" on the very screen they chose to leave.
   *
   * Idempotent: ending an unknown room is a no-op, because a skip and a
   * disconnect racing each other is normal rather than exceptional.
   */
  endRoom(roomId: string, reason: ChatPartnerLeftReason, exceptSocketId?: string): void {
    const session = this.#store.findSessionByRoom(roomId)
    if (session === null) return

    this.#store.deleteSession(roomId)

    for (const participant of [session.a, session.b]) {
      // A participant whose socket already vanished is skipped rather than
      // resurrected; its record is removed by `disconnect`.
      if (this.#store.getUser(participant.socketId) === null) continue

      this.#store.setUserState(participant.socketId, 'ended', null)

      if (participant.socketId !== exceptSocketId) {
        this.#emitter.to(participant.socketId, ServerEvent.chatPartnerLeft, { reason })
      }
    }
  }

  /**
   * `chat:leave`: the leaver goes to `idle`, the partner to `ended`.
   *
   * Split from `skip` because the outcomes differ. Leaving is "I am done";
   * `MatchmakingService.skip` is "I am done, put me back in line".
   */
  leaveChat(socketId: string): void {
    const user = this.requireUser(socketId)

    if (user.state !== 'chatting' || user.roomId === null) {
      throw new ServiceError(ErrorCode.notInChat, 'You are not in a chat.')
    }

    this.endRoom(user.roomId, 'left', socketId)
    this.#store.setUserState(socketId, 'idle', null)
  }

  /**
   * Cleanup for a socket that went away. Safe to call more than once and safe to
   * call on a socket that was never in anything.
   */
  disconnect(socketId: string): void {
    const user = this.#store.getUser(socketId)
    if (user === null) return

    if (user.state === 'chatting' && user.roomId !== null) {
      this.endRoom(user.roomId, 'disconnected', socketId)
    }

    this.#store.removeUser(socketId)
  }
}
