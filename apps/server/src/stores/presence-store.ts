/**
 * Counts distinct identities with at least one live socket.
 *
 * The legacy app counted the union of "logged in" and "has a socket", and only
 * ever removed from the second set, so the number drifted upward forever. Here
 * a socketId maps to exactly one identityId and refcounts are symmetric, so
 * two tabs of one account count once and count zero after both close.
 */
export interface PresenceStore {
  add(socketId: string, identityId: string): number
  remove(socketId: string): number
  identityOf(socketId: string): string | undefined
  count(): number
}

export class InMemoryPresenceStore implements PresenceStore {
  readonly #socketToIdentity = new Map<string, string>()
  readonly #identityToSockets = new Map<string, Set<string>>()

  add(socketId: string, identityId: string): number {
    const existing = this.#socketToIdentity.get(socketId)
    if (existing !== undefined) this.remove(socketId)

    this.#socketToIdentity.set(socketId, identityId)

    const sockets = this.#identityToSockets.get(identityId)
    if (sockets === undefined) {
      this.#identityToSockets.set(identityId, new Set([socketId]))
    } else {
      sockets.add(socketId)
    }

    return this.count()
  }

  remove(socketId: string): number {
    const identityId = this.#socketToIdentity.get(socketId)
    if (identityId === undefined) return this.count()

    this.#socketToIdentity.delete(socketId)

    const sockets = this.#identityToSockets.get(identityId)
    if (sockets !== undefined) {
      sockets.delete(socketId)
      // Only drop the identity once its last socket is gone.
      if (sockets.size === 0) this.#identityToSockets.delete(identityId)
    }

    return this.count()
  }

  identityOf(socketId: string): string | undefined {
    return this.#socketToIdentity.get(socketId)
  }

  count(): number {
    return this.#identityToSockets.size
  }
}
