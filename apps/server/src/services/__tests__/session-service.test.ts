import { describe, expect, it } from 'vitest'
import { ErrorCode, ServerEvent, allowedTransitions, type UserState } from '@anonmatch/shared'
import { connect, createHarness, matchPair } from '../../testing/harness.js'

/**
 * The full matrix, asserted against the contract rather than against a
 * hardcoded copy of it. If `allowedTransitions` changes in the shared package,
 * this test fails and names the states that disagree, rather than the state
 * machine and the client silently diverging.
 */
describe('the state machine matches the shared contract', () => {
  it('permits exactly the transitions the contract lists, for every state', () => {
    const states: readonly UserState[] = ['idle', 'queued', 'chatting', 'ended']

    for (const from of states) {
      const harness = createHarness()
      connect(harness, 's')

      for (const to of states) {
        // Force the starting state directly so every cell of the matrix is
        // reachable without arranging a plausible history first.
        harness.store.setUserState('s', from, to === 'chatting' ? 'room_x' : null)
        harness.emitter.clear()

        const expected = allowedTransitions[from].includes(to)

        if (expected) {
          harness.sessions.transition('s', to, to === 'chatting' ? 'room_y' : null)
          expect(harness.sessions.stateOf('s')).toBe(to)
        } else {
          expect(() => harness.sessions.transition('s', to, null)).toThrowError(
            expect.objectContaining({ code: ErrorCode.illegalTransition }),
          )
          // A rejected transition must leave the state exactly as it was.
          expect(harness.sessions.stateOf('s')).toBe(from)
        }
      }
    }
  })

  it('treats queued -> queued as illegal, which is what makes a double join a bug', () => {
    expect(allowedTransitions.queued).not.toContain('queued')
  })

  it('treats chatting -> idle as illegal: a chat is not abandoned, it is left', () => {
    expect(allowedTransitions.chatting).not.toContain('idle')
  })
})

describe('register', () => {
  it('starts everyone idle with no room', () => {
    const harness = createHarness()
    const record = harness.sessions.register('s', 'google:s')

    expect(record.state).toBe('idle')
    expect(record.roomId).toBeNull()
    expect(harness.sessions.roomOf('s')).toBeNull()
  })

  it('preserves state if the same socket id registers twice', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')

    // Re-registering must not reset someone mid-chat to idle, which would strand
    // their partner in a room that no longer claims them.
    harness.sessions.register('a', 'google:a')

    expect(harness.sessions.stateOf('a')).toBe('chatting')
  })
})

describe('pair', () => {
  it('tells both sides the same room id and moves both to chatting', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')

    const room = matchPair(harness, 'a', 'b')

    expect(harness.sessions.roomOf('a')).toBe(room)
    expect(harness.sessions.roomOf('b')).toBe(room)
  })

  it('gives every room a distinct id', () => {
    const harness = createHarness()
    const rooms = new Set<string>()

    for (const [a, b] of [
      ['a1', 'b1'],
      ['a2', 'b2'],
      ['a3', 'b3'],
    ] satisfies Array<[string, string]>) {
      connect(harness, a)
      connect(harness, b)
      rooms.add(matchPair(harness, a, b))
    }

    expect(rooms.size).toBe(3)
  })

  it('refuses to pair anyone who is not waiting, leaving both untouched', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    harness.matchmaking.join('a')

    expect(() =>
      harness.sessions.pair(
        { socketId: 'a', identityId: 'google:a' },
        {
          socketId: 'b',
          identityId: 'google:b',
        },
      ),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.illegalTransition }))

    expect(harness.sessions.stateOf('a')).toBe('queued')
    expect(harness.sessions.stateOf('b')).toBe('idle')
    expect(harness.emitter.count('b', ServerEvent.matchFound)).toBe(0)
  })
})

describe('partnerOf', () => {
  it('is symmetric', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')

    expect(harness.sessions.partnerOf('a')?.socketId).toBe('b')
    expect(harness.sessions.partnerOf('b')?.socketId).toBe('a')
  })

  it('is null for someone who is not chatting', () => {
    const harness = createHarness()
    connect(harness, 'lonely')

    expect(harness.sessions.partnerOf('lonely')).toBeNull()
  })
})

describe('endRoom', () => {
  it('lands both sides in ended and tells everyone except the cause', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    const room = matchPair(harness, 'a', 'b')
    harness.emitter.clear()

    harness.sessions.endRoom(room, 'left', 'a')

    expect(harness.sessions.stateOf('a')).toBe('ended')
    expect(harness.sessions.stateOf('b')).toBe('ended')
    expect(harness.emitter.payloads('b', ServerEvent.chatPartnerLeft)).toEqual([{ reason: 'left' }])
    expect(harness.emitter.count('a', ServerEvent.chatPartnerLeft)).toBe(0)
  })

  it('is a no-op for a room that does not exist', () => {
    const harness = createHarness()

    expect(() => harness.sessions.endRoom('room_nope', 'left')).not.toThrow()
  })

  it('cannot end the same room twice', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    const room = matchPair(harness, 'a', 'b')
    harness.emitter.clear()

    harness.sessions.endRoom(room, 'left')
    harness.sessions.endRoom(room, 'disconnected')

    expect(harness.emitter.count('b', ServerEvent.chatPartnerLeft)).toBe(1)
  })
})

describe('requireUser', () => {
  it('rejects a socket id the handshake never registered', () => {
    const harness = createHarness()

    expect(() => harness.sessions.requireUser('ghost')).toThrowError(
      expect.objectContaining({ code: ErrorCode.notAuthenticated }),
    )
    expect(harness.sessions.stateOf('ghost')).toBeNull()
  })
})

describe('disconnect', () => {
  it('leaves a queued user registered as removed, so a stale send cannot be routed', () => {
    const harness = createHarness()
    connect(harness, 'a')
    harness.matchmaking.join('a')

    harness.sessions.disconnect('a')

    expect(harness.sessions.stateOf('a')).toBeNull()
    expect(() => harness.chats.send('a', 'anyone there?')).toThrowError(
      expect.objectContaining({ code: ErrorCode.notInChat }),
    )
  })

  it('ignores a disconnect for a socket that never existed', () => {
    const harness = createHarness()

    expect(() => harness.sessions.disconnect('ghost')).not.toThrow()
  })
})
