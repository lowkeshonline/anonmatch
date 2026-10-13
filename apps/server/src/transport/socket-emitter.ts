import type { Emitter, PayloadOf, ServerEventName } from '../services/emitter.js'
import type { ChatServer } from './socket.js'

/** The shape `SocketEmitter.to` presents to Socket.IO's variadic `emit`. */
type EmitFn = <E extends ServerEventName>(event: E, payload: PayloadOf<E>) => void

/**
 * Adapts Socket.IO to the `Emitter` the services use.
 *
 * Services are constructed before the Socket.IO server exists, but they need
 * somewhere to emit, and Socket.IO needs services already wired into its
 * connection handler. This breaks that cycle without handing the services a way
 * to reach a `Socket`: they get `to(socketId, ...)` and nothing else.
 *
 * Emitting before `bind` is a silent no-op rather than a crash. In practice it
 * cannot happen, since the only source of events is a connection handler that
 * runs after `bind`, but a dropped event is a far better failure than a process
 * that dies during startup.
 */
export class SocketEmitter implements Emitter {
  #io: ChatServer | null = null

  bind(io: ChatServer): void {
    this.#io = io
  }

  to<E extends ServerEventName>(socketId: string, event: E, payload: PayloadOf<E>): void {
    const io = this.#io
    // A disconnected socket id is dropped by Socket.IO, which is the right
    // behaviour: the alternative is checking liveness on every single send.
    if (io === null) return

    /**
     * Socket.IO's `emit` is variadic and derives its argument list from a
     * conditional type over the event map, which TypeScript cannot resolve while
     * `E` is still generic. The cast is sound by construction rather than by
     * hope: `PayloadOf<E>` is computed from the very `ServerToClientEvents` the
     * server is typed with, so `event` and `payload` are a matched pair already.
     * This adapter is the single place that bridges the two views.
     */
    const target = io.to(socketId) as unknown as { emit: EmitFn }
    target.emit(event, payload)
  }
}
