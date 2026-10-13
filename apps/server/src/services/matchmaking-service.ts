import { ErrorCode, ServerEvent } from '@anonmatch/shared'
import { ServiceError } from './service-error.js'
import type { Emitter } from './emitter.js'
import type { SessionService } from './session-service.js'
import type { QueueEntry, QueueStore } from '../stores/queue-store.js'

export interface MatchmakingServiceDeps {
  readonly queue: QueueStore
  readonly sessions: SessionService
  readonly emitter: Emitter
  readonly now: () => number
}

/**
 * Owns the queue and decides who gets matched with whom.
 *
 * Every public method throws `ServiceError` on an illegal request and is
 * otherwise total: it never leaves a socket queued *and* chatting, which is the
 * failure mode that makes a user invisible to the queue while still receiving
 * `match:found`.
 */
export class MatchmakingService {
  readonly #queue: QueueStore
  readonly #sessions: SessionService
  readonly #emitter: Emitter
  readonly #now: () => number

  constructor(deps: MatchmakingServiceDeps) {
    this.#queue = deps.queue
    this.#sessions = deps.sessions
    this.#emitter = deps.emitter
    this.#now = deps.now
  }

  /**
   * `queue:join`.
   *
   * Legal from `idle` and `ended`. The double-join case gets its own code
   * rather than a generic illegal transition, because the client can act on it:
   * it is a retry from a double click, not a desync.
   */
  join(socketId: string): void {
    const user = this.#sessions.requireUser(socketId)

    switch (user.state) {
      case 'queued':
        throw new ServiceError(ErrorCode.alreadyQueued, 'You are already waiting for a stranger.')
      case 'chatting':
        throw new ServiceError(
          ErrorCode.illegalTransition,
          'Skip or leave this chat before queueing again.',
        )
      case 'idle':
      case 'ended':
        break
    }

    this.#sessions.transition(socketId, 'queued', null)
    this.#queue.enqueue(socketId, user.identityId, this.#now())
    this.#emitter.to(socketId, ServerEvent.queueWaiting, {})

    this.drain()
  }

  /** `queue:leave`: give up waiting. Only legal while actually waiting. */
  leave(socketId: string): void {
    const state = this.#sessions.stateOf(socketId)

    if (state !== 'queued') {
      throw new ServiceError(ErrorCode.illegalTransition, 'You are not in the queue.')
    }

    this.#queue.remove(socketId)
    this.#sessions.transition(socketId, 'idle', null)
  }

  /**
   * `chat:skip`.
   *
   * The skipper goes straight back into the queue rather than to `idle`. That is
   * the spec's skip semantics and it is the whole point of the button: one tap
   * to move on, no second tap to re-enter the queue.
   *
   * The partner is told and lands in `ended`, so they get to decide whether to
   * look for someone else.
   */
  skip(socketId: string): void {
    const user = this.#sessions.requireUser(socketId)

    if (user.state !== 'chatting' || user.roomId === null) {
      throw new ServiceError(ErrorCode.notInChat, 'You are not in a chat.')
    }

    this.#sessions.endRoom(user.roomId, 'skipped', socketId)
    this.#sessions.transition(socketId, 'queued', null)
    this.#queue.enqueue(socketId, user.identityId, this.#now())
    this.#emitter.to(socketId, ServerEvent.queueWaiting, {})

    this.drain()
  }

  /**
   * Pairs everyone who can be paired, longest wait first.
   *
   * Runs after every join, leave and skip rather than on a timer, so a match
   * happens on the arrival that made it possible rather than up to a tick later.
   */
  drain(): void {
    for (;;) {
      const pair = this.#takePair()
      if (pair === null) return

      const [first, second] = pair
      this.#queue.remove(first.socketId)
      this.#queue.remove(second.socketId)

      this.#sessions.pair(
        { socketId: first.socketId, identityId: first.identityId },
        { socketId: second.socketId, identityId: second.identityId },
      )
    }
  }

  /**
   * The oldest waiting socket, plus the oldest other person behind it.
   *
   * FIFO with two exclusions, both non-negotiable:
   *
   * - Never the same socket. Without this, a double `queue:join` that slipped
   *   through would match someone with themselves.
   * - Never the same identity. One person on two tabs is still one person, and
   *   pairing them produces a conversation with themselves that looks like a bug
   *   from the inside. It also costs one of the two slots, so they are skipped
   *   over rather than blocking everyone behind them.
   *
   * Returns null when nobody is pairable, which is the normal resting state for
   * an empty queue and for someone alone in it.
   */
  #takePair(): [QueueEntry, QueueEntry] | null {
    const entries = this.#queue.entries()
    const head = entries[0]
    if (head === undefined) return null

    for (let i = 1; i < entries.length; i++) {
      const candidate = entries[i]
      if (candidate === undefined) continue
      if (candidate.identityId === head.identityId) continue

      return [head, candidate]
    }

    return null
  }

  /**
   * A socket went away. Removes it from the queue if it was waiting, then hands
   * off to `SessionService` for the chat case, so a single call covers both and
   * the transport does not have to remember which of the two it is.
   */
  handleDisconnect(socketId: string): void {
    this.#queue.remove(socketId)
    this.#sessions.disconnect(socketId)
  }
}
