/**
 * One person waiting for a stranger.
 *
 * `joinedAt` is carried purely so the store stays a dumb container and any
 * fairness policy (FIFO, longest-waiting-first) stays a service decision.
 */
export interface QueueEntry {
  readonly socketId: string
  readonly identityId: string
  readonly joinedAt: number
}

/**
 * The matchmaking queue, plus the registry of who is currently in it.
 *
 * Intentionally read-only from the service's point of view: `entries()` hands
 * back a fresh array rather than the backing one, so a caller cannot splice a
 * stranger out of the queue or hold a live reference across a mutation. The
 * entries themselves are shared, which is fine because `QueueEntry` fields are
 * `readonly` and an entry is never edited after it is enqueued.
 *
 * `RedisQueueStore` would be a drop-in replacement later, but note that a real
 * FIFO queue needs an atomic "pop the oldest two distinct entries" operation,
 * not the read-then-remove pair used here. `MatchmakingService` is the only
 * caller, so keeping the pairing policy in one place is what makes that swap
 * safe.
 */
export interface QueueStore {
  enqueue(socketId: string, identityId: string, now: number): void
  remove(socketId: string): boolean
  /** Oldest first. */
  entries(): readonly QueueEntry[]
  size(): number
}

export class InMemoryQueueStore implements QueueStore {
  readonly #entries: QueueEntry[] = []
  readonly #bySocket = new Map<string, number>()

  enqueue(socketId: string, identityId: string, now: number): void {
    // Defensive: a socket already queued is replaced, never duplicated.
    // `MatchmakingService` rejects that case with ALREADY_QUEUED first, so this
    // only runs if a future caller forgets, and duplicates would silently break
    // pairing rather than fail loudly.
    if (this.#bySocket.has(socketId)) this.remove(socketId)

    this.#bySocket.set(socketId, this.#entries.length)
    this.#entries.push({ socketId, identityId, joinedAt: now })
  }

  remove(socketId: string): boolean {
    const index = this.#bySocket.get(socketId)
    if (index === undefined) return false

    this.#entries.splice(index, 1)
    // Splicing shifts every later index down by one, so the index map has to be
    // rebuilt. A stale entry here would make a later `remove` delete the wrong
    // person, which is exactly the kind of bug that only shows up as "the wrong
    // stranger matched me".
    this.#bySocket.clear()
    for (let i = 0; i < this.#entries.length; i++) {
      const entry = this.#entries[i]
      if (entry !== undefined) this.#bySocket.set(entry.socketId, i)
    }
    return true
  }

  entries(): readonly QueueEntry[] {
    return [...this.#entries]
  }

  size(): number {
    return this.#entries.length
  }
}
