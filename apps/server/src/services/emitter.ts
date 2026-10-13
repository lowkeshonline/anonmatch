import type { ServerToClientEvents } from '@anonmatch/shared'

/** Every event name the server can push. */
export type ServerEventName = keyof ServerToClientEvents
export type PayloadOf<E extends ServerEventName> = Parameters<ServerToClientEvents[E]>[0]

/**
 * The one thing services are allowed to use to talk to a client.
 *
 * Services never see a Socket.IO `Socket`. They know a socket *id*, which is
 * what makes them unit-testable: a test passes an id and records what came out,
 * with no network and no real socket.
 *
 * Per-socket rather than per-room because `chat:message` is not symmetric: the
 * sender receives `from: 'you'` and the partner receives `from: 'stranger'` from
 * the same logical message. A room broadcast cannot express that. The legacy app
 * did broadcast, and the client had to guess which side of a bubble it was.
 */
export interface Emitter {
  to<E extends ServerEventName>(socketId: string, event: E, payload: PayloadOf<E>): void
}
