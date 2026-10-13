import { describe, expect, it } from 'vitest'
import { ErrorCode, ServerEvent } from '@anonmatch/shared'
import { connect, createHarness, matchPair } from '../../testing/harness.js'

describe('queue FIFO ordering', () => {
  it('yields arrivals in the order they joined', () => {
    const harness = createHarness()
    connect(harness, 's1')
    connect(harness, 's2')
    connect(harness, 's3')

    harness.matchmaking.join('s1')
    harness.matchmaking.join('s2')
    harness.matchmaking.join('s3')

    // s1 and s2 matched, so only s3 is left, and it is the only entry.
    expect(harness.queue.size()).toBe(1)
    expect(harness.queue.entries().map((entry) => entry.socketId)).toEqual(['s3'])
  })

  it('pairs in arrival order when several people are waiting at once', () => {
    const harness = createHarness()
    for (const id of ['s1', 's2', 's3', 's4']) connect(harness, id)

    // Normally impossible: `drain` runs on every join, so a second arrival pairs
    // immediately. Forced here to prove the ordering rule itself, which is what a
    // shared Redis queue would rely on when several joins land concurrently.
    for (const id of ['s1', 's2', 's3', 's4']) {
      harness.store.setUserState(id, 'queued', null)
      harness.queue.enqueue(id, `google:${id}`, 0)
    }

    harness.matchmaking.drain()

    const roomOf = (socketId: string) =>
      harness.emitter.latest<{ roomId: string }>(socketId, ServerEvent.matchFound)?.roomId

    // The two longest waits pair with each other, then the two who arrived after.
    expect(roomOf('s1')).toBe(roomOf('s2'))
    expect(roomOf('s3')).toBe(roomOf('s4'))
    expect(roomOf('s1')).not.toBe(roomOf('s3'))
    expect(harness.queue.size()).toBe(0)
  })

  it('leaves the person who arrived last still waiting when the queue is odd', () => {
    const harness = createHarness()
    for (const id of ['s1', 's2', 's3']) {
      connect(harness, id)
      harness.store.setUserState(id, 'queued', null)
      harness.queue.enqueue(id, `google:${id}`, 0)
    }

    harness.matchmaking.drain()

    expect(harness.emitter.count('s1', ServerEvent.matchFound)).toBe(1)
    expect(harness.emitter.count('s3', ServerEvent.matchFound)).toBe(0)
    expect(harness.queue.entries().map((entry) => entry.socketId)).toEqual(['s3'])
  })
})

describe('no self match', () => {
  it('never matches a socket with itself', () => {
    const harness = createHarness()
    connect(harness, 's1')

    // Force the pathological state a double join would create if it slipped past
    // the ALREADY_QUEUED guard, and prove the pairing rule still holds.
    harness.store.setUserState('s1', 'queued', null)
    harness.queue.enqueue('s1', 'google:s1', 0)
    harness.queue.enqueue('s1', 'google:s1', 1)

    harness.matchmaking.drain()

    expect(harness.sessions.stateOf('s1')).toBe('queued')
    expect(harness.emitter.count('s1', ServerEvent.matchFound)).toBe(0)
  })

  it('never matches two tabs of the same person, and does not let them block others', () => {
    const harness = createHarness()
    connect(harness, 'tabA1', 'google:same')
    connect(harness, 'tabA2', 'google:same')
    connect(harness, 'b')

    harness.matchmaking.join('tabA1')
    harness.matchmaking.join('tabA2')
    harness.matchmaking.join('b')

    // The person on two tabs cannot be paired with themselves, so b pairs with
    // whoever has waited longest instead of waiting behind them forever.
    expect(harness.emitter.count('tabA1', ServerEvent.matchFound)).toBe(1)
    expect(harness.emitter.count('tabA2', ServerEvent.matchFound)).toBe(0)
    expect(harness.emitter.count('b', ServerEvent.matchFound)).toBe(1)
    expect(harness.sessions.stateOf('tabA2')).toBe('queued')
  })
})

describe('queue:join', () => {
  it('confirms the wait and parks the user in queued', () => {
    const harness = createHarness()
    connect(harness, 's1')

    harness.matchmaking.join('s1')

    expect(harness.emitter.count('s1', ServerEvent.queueWaiting)).toBe(1)
    expect(harness.sessions.stateOf('s1')).toBe('queued')
  })

  it('rejects a double join with ALREADY_QUEUED rather than queueing twice', () => {
    const harness = createHarness()
    connect(harness, 's1')
    harness.matchmaking.join('s1')
    harness.emitter.clear()

    expect(() => harness.matchmaking.join('s1')).toThrowError(
      expect.objectContaining({ code: ErrorCode.alreadyQueued }),
    )
    expect(harness.queue.size()).toBe(1)
  })

  it('rejects queueing while already chatting', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')

    expect(() => harness.matchmaking.join('a')).toThrowError(
      expect.objectContaining({ code: ErrorCode.illegalTransition }),
    )
    expect(harness.queue.size()).toBe(0)
    expect(harness.sessions.stateOf('a')).toBe('chatting')
  })

  it('lets someone who ended a chat queue again', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')

    harness.sessions.leaveChat('a')
    expect(harness.sessions.stateOf('a')).toBe('idle')

    harness.matchmaking.join('a')
    expect(harness.sessions.stateOf('a')).toBe('queued')
  })
})

describe('queue:leave', () => {
  it('takes the user out of the queue and back to idle', () => {
    const harness = createHarness()
    connect(harness, 's1')
    connect(harness, 's2')
    harness.matchmaking.join('s1')
    harness.emitter.clear()

    harness.matchmaking.leave('s1')

    expect(harness.queue.size()).toBe(0)
    expect(harness.sessions.stateOf('s1')).toBe('idle')
  })

  it('leaves the queue usable for whoever arrives next', () => {
    const harness = createHarness()
    for (const id of ['a', 'b', 'c', 'd', 'e']) connect(harness, id)

    // a and b pair off, leaving c waiting alone.
    harness.matchmaking.join('a')
    harness.matchmaking.join('b')
    harness.matchmaking.join('c')

    harness.matchmaking.leave('c')
    expect(harness.queue.size()).toBe(0)
    harness.emitter.clear()

    // d waits, then e arrives and the pair forms as normal.
    harness.matchmaking.join('d')
    harness.emitter.clear()
    harness.matchmaking.join('e')

    expect(harness.emitter.count('d', ServerEvent.matchFound)).toBe(1)
    expect(harness.emitter.count('e', ServerEvent.matchFound)).toBe(1)
    expect(harness.sessions.stateOf('c')).toBe('idle')
  })

  it('rejects leaving the queue when not queued', () => {
    const harness = createHarness()
    connect(harness, 's1')

    expect(() => harness.matchmaking.leave('s1')).toThrowError(
      expect.objectContaining({ code: ErrorCode.illegalTransition }),
    )
  })
})

describe('chat:skip', () => {
  it('puts the skipper straight back in the queue and ends the partner', () => {
    const harness = createHarness()
    connect(harness, 'skipper')
    connect(harness, 'partner')
    matchPair(harness, 'skipper', 'partner')
    harness.emitter.clear()

    harness.matchmaking.skip('skipper')

    expect(harness.sessions.stateOf('skipper')).toBe('queued')
    expect(harness.sessions.stateOf('partner')).toBe('ended')
    expect(harness.queue.entries().map((entry) => entry.socketId)).toEqual(['skipper'])

    expect(harness.emitter.payloads('partner', ServerEvent.chatPartnerLeft)).toEqual([
      { reason: 'skipped' },
    ])
    expect(harness.emitter.count('skipper', ServerEvent.queueWaiting)).toBe(1)
  })

  it('does not tell the skipper the partner left', () => {
    const harness = createHarness()
    connect(harness, 'skipper')
    connect(harness, 'partner')
    matchPair(harness, 'skipper', 'partner')
    harness.emitter.clear()

    harness.matchmaking.skip('skipper')

    // They asked to move on. A partner_left here would flash "stranger left" on
    // the screen they just chose to leave.
    expect(harness.emitter.count('skipper', ServerEvent.chatPartnerLeft)).toBe(0)
  })

  it('immediately matches the skipper with someone who was already waiting', () => {
    const harness = createHarness()
    connect(harness, 'skipper')
    connect(harness, 'partner')
    connect(harness, 'waiting')
    matchPair(harness, 'skipper', 'partner')

    harness.matchmaking.join('waiting')
    harness.emitter.clear()

    harness.matchmaking.skip('skipper')

    expect(harness.emitter.count('skipper', ServerEvent.matchFound)).toBe(1)
    expect(harness.emitter.count('waiting', ServerEvent.matchFound)).toBe(1)
    expect(harness.sessions.stateOf('skipper')).toBe('chatting')
    expect(harness.sessions.stateOf('waiting')).toBe('chatting')
    expect(harness.sessions.stateOf('partner')).toBe('ended')
  })

  it('rejects a skip when not chatting', () => {
    const harness = createHarness()
    connect(harness, 's1')

    expect(() => harness.matchmaking.skip('s1')).toThrowError(
      expect.objectContaining({ code: ErrorCode.notInChat }),
    )
  })

  it('rejects a skip when already waiting in the queue', () => {
    const harness = createHarness()
    connect(harness, 's1')

    harness.matchmaking.join('s1')

    expect(() => harness.matchmaking.skip('s1')).toThrowError(
      expect.objectContaining({ code: ErrorCode.notInChat }),
    )
  })
})

describe('chat:leave', () => {
  it('sends the leaver to idle and the partner to ended', () => {
    const harness = createHarness()
    connect(harness, 'leaver')
    connect(harness, 'partner')
    matchPair(harness, 'leaver', 'partner')
    harness.emitter.clear()

    harness.sessions.leaveChat('leaver')

    expect(harness.sessions.stateOf('leaver')).toBe('idle')
    expect(harness.sessions.stateOf('partner')).toBe('ended')
    expect(harness.queue.size()).toBe(0)
    expect(harness.emitter.payloads('partner', ServerEvent.chatPartnerLeft)).toEqual([
      { reason: 'left' },
    ])
    expect(harness.emitter.count('leaver', ServerEvent.chatPartnerLeft)).toBe(0)
  })

  it('rejects a leave when not chatting', () => {
    const harness = createHarness()
    connect(harness, 's1')

    expect(() => harness.sessions.leaveChat('s1')).toThrowError(
      expect.objectContaining({ code: ErrorCode.notInChat }),
    )
  })
})

describe('disconnect', () => {
  it('removes someone from the queue without notifying anyone', () => {
    const harness = createHarness()
    connect(harness, 's1')
    connect(harness, 's2')
    harness.matchmaking.join('s1')
    harness.emitter.clear()

    harness.matchmaking.handleDisconnect('s1')

    expect(harness.queue.size()).toBe(0)
    expect(harness.sessions.stateOf('s1')).toBeNull()
    expect(harness.emitter.count('s2', ServerEvent.chatPartnerLeft)).toBe(0)
  })

  it('tells the partner and ends the chat when it happens mid-conversation', () => {
    const harness = createHarness()
    connect(harness, 'leaver')
    connect(harness, 'stayer')
    matchPair(harness, 'leaver', 'stayer')
    harness.emitter.clear()

    harness.matchmaking.handleDisconnect('leaver')

    expect(harness.emitter.payloads('stayer', ServerEvent.chatPartnerLeft)).toEqual([
      { reason: 'disconnected' },
    ])
    expect(harness.sessions.stateOf('stayer')).toBe('ended')
    expect(harness.sessions.stateOf('leaver')).toBeNull()
  })

  it('frees the partner for a new match instead of stranding them', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    connect(harness, 'c')
    matchPair(harness, 'a', 'b')

    harness.matchmaking.handleDisconnect('a')
    harness.emitter.clear()

    // b re-queues and is matched with c, proving the room was really torn down.
    harness.matchmaking.join('b')
    harness.matchmaking.join('c')

    expect(harness.emitter.count('b', ServerEvent.matchFound)).toBe(1)
    expect(harness.emitter.count('c', ServerEvent.matchFound)).toBe(1)
  })

  it('is idempotent, so a duplicate disconnect cannot double-notify', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')
    harness.emitter.clear()

    harness.matchmaking.handleDisconnect('a')
    harness.matchmaking.handleDisconnect('a')

    expect(harness.emitter.count('b', ServerEvent.chatPartnerLeft)).toBe(1)
  })

  it('survives a skip and a disconnect racing on the same room', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')

    const room = harness.sessions.roomOf('a')
    harness.matchmaking.skip('a')
    harness.sessions.endRoom(room ?? '', 'disconnected')

    // Both sides acted on a room that was already gone; nobody crashed and the
    // skipper kept their queue place.
    expect(harness.sessions.stateOf('a')).toBe('queued')
    expect(harness.sessions.stateOf('b')).toBe('ended')
  })
})

describe('stale socket ids', () => {
  it('rejects queueing for a socket that was never registered', () => {
    const harness = createHarness()

    expect(() => harness.matchmaking.join('ghost')).toThrowError(
      expect.objectContaining({ code: ErrorCode.notAuthenticated }),
    )
  })

  it('ignores a disconnect for a socket that is already gone', () => {
    const harness = createHarness()

    expect(() => harness.matchmaking.handleDisconnect('ghost')).not.toThrow()
    expect(harness.queue.size()).toBe(0)
  })

  it('rejects messaging from a socket whose chat was already ended', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')

    harness.sessions.leaveChat('a')

    expect(() => harness.chats.send('a', 'hello')).toThrowError(
      expect.objectContaining({ code: ErrorCode.notInChat }),
    )
  })

  it('does not resurrect a room for a participant whose socket already vanished', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')

    const room = harness.sessions.roomOf('a') ?? ''
    harness.store.removeUser('b')
    harness.emitter.clear()

    harness.sessions.endRoom(room, 'skipped', 'a')

    expect(harness.emitter.count('b', ServerEvent.chatPartnerLeft)).toBe(0)
    expect(harness.emitter.count('a', ServerEvent.chatPartnerLeft)).toBe(0)
  })
})
