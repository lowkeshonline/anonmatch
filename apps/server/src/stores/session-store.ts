import type { UserState } from '@anonmatch/shared'

/**
 * Per-socket server-side state.
 *
 * Keyed by `socketId`, not `identityId`. One person can have several sockets
 * (two tabs), and each tab is independently matchable and independently rate
 * limited. Identity is carried along so a pair can be described without a second
 * lookup.
 */
export interface UserRecord {
  readonly socketId: string
  readonly identityId: string
  state: UserState
  /** Non-null exactly while `state` is `chatting`. */
  roomId: string | null
}

/** One side of a chat pair. */
export interface SessionParticipant {
  readonly socketId: string
  readonly identityId: string
}

export interface ChatSession {
  readonly roomId: string
  readonly createdAt: number
  readonly a: SessionParticipant
  readonly b: SessionParticipant
}

/**
 * Owns the state machine and the chat pairs.
 *
 * Deliberately *not* the same thing as `AuthSessionStore`: that one maps a long
 * lived token to an identity across sockets, this one owns who is talking to
 * whom right now. Separating them means a reconnect keeps your identity without
 * inheriting a room that no longer exists.
 *
 * This store holds no rules. It does not check whether a transition is legal;
 * `SessionService` consults `allowedTransitions` from the shared contract and is
 * the only caller allowed to decide. That is what keeps the state machine in one
 * file instead of spread across five.
 */
export interface SessionStore {
  registerUser(socketId: string, identityId: string): UserRecord
  getUser(socketId: string): UserRecord | null
  setUserState(socketId: string, state: UserState, roomId: string | null): void

  createSession(a: SessionParticipant, b: SessionParticipant, now: number): ChatSession
  findSessionByRoom(roomId: string): ChatSession | null
  findSessionBySocket(socketId: string): ChatSession | null
  deleteSession(roomId: string): boolean

  removeUser(socketId: string): void
}

export class InMemorySessionStore implements SessionStore {
  readonly #users = new Map<string, UserRecord>()
  readonly #sessions = new Map<string, ChatSession>()
  /** socketId -> roomId, so `findSessionBySocket` stays O(1). */
  readonly #socketRoom = new Map<string, string>()
  #roomSeq = 0

  registerUser(socketId: string, identityId: string): UserRecord {
    const existing = this.#users.get(socketId)
    // Socket ids are not reused, so this only fires if a caller re-registers.
    // Preserving the existing state is the safer of the two behaviours: it
    // cannot strand someone in `queued` when their socket is replaced.
    if (existing !== undefined) return existing

    const record: UserRecord = { socketId, identityId, state: 'idle', roomId: null }
    this.#users.set(socketId, record)
    return record
  }

  getUser(socketId: string): UserRecord | null {
    return this.#users.get(socketId) ?? null
  }

  setUserState(socketId: string, state: UserState, roomId: string | null): void {
    const record = this.#users.get(socketId)
    if (record === undefined) return

    record.state = state
    record.roomId = roomId
  }

  createSession(a: SessionParticipant, b: SessionParticipant, now: number): ChatSession {
    this.#roomSeq += 1
    const roomId = `room_${now.toString(36)}_${this.#roomSeq.toString(36)}`
    const session: ChatSession = { roomId, createdAt: now, a, b }

    this.#sessions.set(roomId, session)
    this.#socketRoom.set(a.socketId, roomId)
    this.#socketRoom.set(b.socketId, roomId)
    return session
  }

  findSessionByRoom(roomId: string): ChatSession | null {
    return this.#sessions.get(roomId) ?? null
  }

  findSessionBySocket(socketId: string): ChatSession | null {
    const roomId = this.#socketRoom.get(socketId)
    if (roomId === undefined) return null
    return this.#sessions.get(roomId) ?? null
  }

  deleteSession(roomId: string): boolean {
    const session = this.#sessions.get(roomId)
    if (session === undefined) return false

    this.#sessions.delete(roomId)
    // Only clear the index for sockets still pointing at *this* room. A socket
    // that already moved on to a new pair must keep its newer mapping.
    for (const socketId of [session.a.socketId, session.b.socketId]) {
      if (this.#socketRoom.get(socketId) === roomId) this.#socketRoom.delete(socketId)
    }
    return true
  }

  removeUser(socketId: string): void {
    this.#users.delete(socketId)
    this.#socketRoom.delete(socketId)
  }
}
