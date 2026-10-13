import { randomUUID } from 'node:crypto'
import type { Identity } from '@anonmatch/shared'

export interface AuthSession {
  readonly token: string
  readonly identity: Identity
  readonly expiresAt: number
}

/**
 * Auth sessions are not chat sessions. `SessionStore` (M2) owns chat pairs;
 * this owns the token -> identity mapping that survives across sockets. Keeping
 * them separate means a reconnecting user keeps their identity without needing
 * their old room back.
 */
export interface AuthSessionStore {
  create(identity: Identity, now: number): AuthSession
  find(token: string, now: number): Identity | null
  delete(token: string): void
  prune(now: number): void
}

export class InMemoryAuthSessionStore implements AuthSessionStore {
  readonly #sessions = new Map<string, AuthSession>()
  readonly #ttlMs: number

  constructor(ttlMs: number) {
    this.#ttlMs = ttlMs
  }

  create(identity: Identity, now: number): AuthSession {
    const session: AuthSession = {
      token: randomUUID(),
      identity,
      expiresAt: now + this.#ttlMs,
    }
    this.#sessions.set(session.token, session)
    return session
  }

  find(token: string, now: number): Identity | null {
    const session = this.#sessions.get(token)
    if (session === undefined) return null
    if (session.expiresAt <= now) {
      this.#sessions.delete(token)
      return null
    }
    return session.identity
  }

  delete(token: string): void {
    this.#sessions.delete(token)
  }

  prune(now: number): void {
    for (const [token, session] of this.#sessions) {
      if (session.expiresAt <= now) this.#sessions.delete(token)
    }
  }
}
