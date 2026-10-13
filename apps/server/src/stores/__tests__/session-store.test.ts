import { describe, expect, it } from 'vitest'
import { InMemorySessionStore } from '../session-store.js'

describe('InMemorySessionStore', () => {
  it('registers a user idle with no room', () => {
    const store = new InMemorySessionStore()
    const user = store.registerUser('s1', 'google:1')

    expect(user).toMatchObject({
      socketId: 's1',
      identityId: 'google:1',
      state: 'idle',
      roomId: null,
    })
    expect(store.getUser('s1')).toBe(user)
  })

  it('returns null for a socket it has never seen', () => {
    expect(new InMemorySessionStore().getUser('ghost')).toBeNull()
  })

  it('preserves state when the same socket id registers again', () => {
    const store = new InMemorySessionStore()
    store.registerUser('s1', 'google:1')
    store.setUserState('s1', 'chatting', 'room_1')

    const again = store.registerUser('s1', 'google:1')

    expect(again.state).toBe('chatting')
    expect(again.roomId).toBe('room_1')
  })

  it('silently ignores a state change for an unknown socket', () => {
    const store = new InMemorySessionStore()

    expect(() => store.setUserState('ghost', 'chatting', 'room_1')).not.toThrow()
  })

  it('finds a session from either side', () => {
    const store = new InMemorySessionStore()
    const session = store.createSession(
      { socketId: 'a', identityId: 'google:a' },
      { socketId: 'b', identityId: 'google:b' },
      1000,
    )

    expect(store.findSessionBySocket('a')?.roomId).toBe(session.roomId)
    expect(store.findSessionBySocket('b')?.roomId).toBe(session.roomId)
    expect(store.findSessionByRoom(session.roomId)).toBe(session)
  })

  it('returns null from every lookup once the session is deleted', () => {
    const store = new InMemorySessionStore()
    const session = store.createSession(
      { socketId: 'a', identityId: 'google:a' },
      { socketId: 'b', identityId: 'google:b' },
      1000,
    )

    expect(store.deleteSession(session.roomId)).toBe(true)

    expect(store.findSessionByRoom(session.roomId)).toBeNull()
    expect(store.findSessionBySocket('a')).toBeNull()
    expect(store.findSessionBySocket('b')).toBeNull()
    expect(store.deleteSession(session.roomId)).toBe(false)
  })

  it('does not clear a socket that has already moved on to a newer room', () => {
    const store = new InMemorySessionStore()
    const oldRoom = store.createSession(
      { socketId: 'a', identityId: 'google:a' },
      { socketId: 'b', identityId: 'google:b' },
      1000,
    )
    const newRoom = store.createSession(
      { socketId: 'a', identityId: 'google:a' },
      { socketId: 'c', identityId: 'google:c' },
      2000,
    )

    // A late teardown of the previous room must not orphan the current one,
    // which is exactly the shape of a skip racing a disconnect.
    store.deleteSession(oldRoom.roomId)

    expect(store.findSessionBySocket('a')?.roomId).toBe(newRoom.roomId)
  })

  it('gives every session a distinct room id', () => {
    const store = new InMemorySessionStore()
    const ids = new Set<string>()

    for (let i = 0; i < 5; i++) {
      const session = store.createSession(
        { socketId: `a${i}`, identityId: `google:a${i}` },
        { socketId: `b${i}`, identityId: `google:b${i}` },
        1000,
      )
      ids.add(session.roomId)
    }

    expect(ids.size).toBe(5)
  })

  it('forgets a removed user completely', () => {
    const store = new InMemorySessionStore()
    store.createSession(
      { socketId: 'a', identityId: 'google:a' },
      { socketId: 'b', identityId: 'google:b' },
      1000,
    )

    store.removeUser('a')

    expect(store.getUser('a')).toBeNull()
    expect(store.findSessionBySocket('a')).toBeNull()
    // The partner's side is untouched: tearing down one user's bookkeeping must
    // not decide the outcome for someone else.
    expect(store.findSessionBySocket('b')?.roomId).toBeDefined()
  })
})
