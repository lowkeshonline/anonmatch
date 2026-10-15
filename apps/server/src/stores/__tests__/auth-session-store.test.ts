import { describe, expect, it } from 'vitest'
import type { Identity } from '@anonmatch/shared'
import { InMemoryAuthSessionStore } from '../auth-session-store.js'

const identity: Identity = {
  id: 'google:1',
  email: 'one@test.local',
  name: 'One',
  picture: null,
}

describe('InMemoryAuthSessionStore', () => {
  it('prunes expired tokens and keeps live ones', () => {
    // Fake clock, same shape as `testing/harness.ts`: the TTL is 24h of real
    // time, so expiry cannot be reached by waiting.
    const now = 1_700_000_000_000
    const store = new InMemoryAuthSessionStore(1_000)

    const stale = store.create(identity, now)
    const live = store.create(identity, now + 600)

    store.prune(now + 1_500)

    expect(store.find(stale.token, now + 1_500)).toBeNull()
    expect(store.find(live.token, now + 1_500)).toBe(identity)
  })
})
