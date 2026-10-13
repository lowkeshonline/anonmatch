import type { Emitter, PayloadOf, ServerEventName } from '../services/emitter.js'
import { ChatService } from '../services/chat-service.js'
import { MatchmakingService } from '../services/matchmaking-service.js'
import { SessionService } from '../services/session-service.js'
import { InMemoryQueueStore } from '../stores/queue-store.js'
import { InMemorySessionStore } from '../stores/session-store.js'

/**
 * One thing that was sent, kept as data so assertions can ask questions like
 * "did the skipper get told the partner left?" instead of comparing whole event
 * logs.
 */
export interface SentEvent {
  readonly socketId: string
  readonly event: ServerEventName
  readonly payload: unknown
}

/**
 * Records emissions instead of sending them.
 *
 * This is the whole reason services depend on an `Emitter` rather than on
 * Socket.IO: the entire matchmaking and chat state machine is exercised here
 * with no network, no ports and no timing races between real sockets.
 */
export class RecordingEmitter implements Emitter {
  readonly sent: SentEvent[] = []

  to<E extends ServerEventName>(socketId: string, event: E, payload: PayloadOf<E>): void {
    this.sent.push({ socketId, event, payload })
  }

  /** Every payload this socket was sent for one event, oldest first. */
  payloads<T = unknown>(socketId: string, event: ServerEventName): T[] {
    return this.sent
      .filter((sent) => sent.socketId === socketId && sent.event === event)
      .map((sent) => sent.payload as T)
  }

  latest<T = unknown>(socketId: string, event: ServerEventName): T | undefined {
    const all = this.payloads<T>(socketId, event)
    return all.at(-1)
  }

  count(socketId: string, event: ServerEventName): number {
    return this.payloads(socketId, event).length
  }

  clear(): void {
    this.sent.length = 0
  }
}

export interface Harness {
  readonly sessions: SessionService
  readonly matchmaking: MatchmakingService
  readonly chats: ChatService
  readonly queue: InMemoryQueueStore
  readonly store: InMemorySessionStore
  readonly emitter: RecordingEmitter
  /** Moves the fake clock. Drives the rate-limit window and timestamps. */
  advance(ms: number): void
}

const FIXED_NOW = 1_700_000_000_000

/**
 * The real service graph over in-memory stores and a fake clock.
 *
 * A fake clock rather than `Date.now()` because the rate limiter's behaviour
 * depends on a 3 second window, and a test that has to `await sleep(3100)` to
 * check it is a test nobody runs.
 */
export function createHarness(): Harness {
  const emitter = new RecordingEmitter()
  const queue = new InMemoryQueueStore()
  const store = new InMemorySessionStore()

  let clock = FIXED_NOW
  const now = () => clock

  let messageSeq = 0
  const newId = () => `msg_${(messageSeq += 1)}`

  const sessions = new SessionService({ store, emitter, now })
  const matchmaking = new MatchmakingService({ queue, sessions, emitter, now })
  const chats = new ChatService({ sessions, emitter, now, newId })

  return {
    sessions,
    matchmaking,
    chats,
    queue,
    store,
    emitter,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

/**
 * Registers a socket the way the connection handler does.
 *
 * Identity defaults to one derived from the socket id, so two tabs of one person
 * have to be spelled out explicitly via the second argument. That asymmetry is
 * intentional: it stops a test accidentally exercising the no-self-match rule.
 */
export function connect(harness: Harness, socketId: string, identityId?: string): string {
  harness.sessions.register(socketId, identityId ?? `google:${socketId}`)
  return socketId
}

/** Puts two people in a chat, asserting that it actually happened. */
export function matchPair(harness: Harness, a: string, b: string): string {
  const first = harness.emitter.sent.length
  harness.matchmaking.join(a)
  harness.matchmaking.join(b)

  const matchFound = harness.emitter.sent
    .slice(first)
    .filter((sent) => sent.event === 'match:found')
  if (matchFound.length !== 2) throw new Error(`expected 2 match:found, got ${matchFound.length}`)

  const roomId = (matchFound[0]?.payload as { roomId: string }).roomId
  harness.emitter.clear()
  return roomId
}
