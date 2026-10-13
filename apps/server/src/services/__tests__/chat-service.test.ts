import { describe, expect, it } from 'vitest'
import {
  ErrorCode,
  MAX_MESSAGE_LENGTH,
  RATE_LIMIT_MESSAGES,
  RATE_LIMIT_WINDOW_MS,
  ServerEvent,
  type ChatMessageOutbound,
} from '@anonmatch/shared'
import { connect, createHarness, matchPair } from '../../testing/harness.js'

describe('chat:message delivery', () => {
  it('sends one message to both sides, with `from` relative to the reader', () => {
    const harness = createHarness()
    connect(harness, 'sender')
    connect(harness, 'receiver')
    matchPair(harness, 'sender', 'receiver')
    harness.emitter.clear()

    harness.chats.send('sender', 'hello there')

    const mine = harness.emitter.payloads<ChatMessageOutbound>('sender', ServerEvent.chatMessage)
    const theirs = harness.emitter.payloads<ChatMessageOutbound>(
      'receiver',
      ServerEvent.chatMessage,
    )

    expect(mine).toHaveLength(1)
    expect(theirs).toHaveLength(1)

    // Same id and timestamp on both sides so the client can reconcile its own
    // optimistic copy; `from` differs so the bubble lands on the right side.
    expect(mine[0]?.id).toBe(theirs[0]?.id)
    expect(mine[0]?.ts).toBe(theirs[0]?.ts)
    expect(mine[0]).toMatchObject({ text: 'hello there', from: 'you' })
    expect(theirs[0]).toMatchObject({ text: 'hello there', from: 'stranger' })
  })

  it('trims before delivering, so surrounding whitespace never reaches the partner', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')
    harness.emitter.clear()

    harness.chats.send('a', '   padded message \n\t ')

    expect(harness.emitter.latest<ChatMessageOutbound>('b', ServerEvent.chatMessage)?.text).toBe(
      'padded message',
    )
  })

  it('rejects a whitespace-only message instead of delivering a blank bubble', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')
    harness.emitter.clear()

    expect(() => harness.chats.send('a', '   \n  ')).toThrowError(
      expect.objectContaining({ code: ErrorCode.messageEmpty }),
    )
    expect(() => harness.chats.send('a', '')).toThrowError(
      expect.objectContaining({ code: ErrorCode.messageEmpty }),
    )
    expect(harness.emitter.count('b', ServerEvent.chatMessage)).toBe(0)
  })
})

describe('chat:message length', () => {
  it('accepts a message at exactly the limit', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')

    harness.chats.send('a', 'x'.repeat(MAX_MESSAGE_LENGTH))

    expect(harness.emitter.count('b', ServerEvent.chatMessage)).toBe(1)
  })

  it('rejects one character over the limit', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')

    expect(() => harness.chats.send('a', 'x'.repeat(MAX_MESSAGE_LENGTH + 1))).toThrowError(
      expect.objectContaining({ code: ErrorCode.messageTooLong }),
    )
  })

  it('measures the trimmed text, not the raw string', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')
    harness.emitter.clear()

    // 520 raw characters, of which the trailing 25 are padding. Legal, because
    // only 495 characters are ever shown.
    const padded = `${'x'.repeat(MAX_MESSAGE_LENGTH - 5)}${' '.repeat(25)}`
    expect(padded.length).toBeGreaterThan(MAX_MESSAGE_LENGTH)

    harness.chats.send('a', padded)

    expect(
      harness.emitter.latest<ChatMessageOutbound>('b', ServerEvent.chatMessage)?.text,
    ).toHaveLength(MAX_MESSAGE_LENGTH - 5)
  })
})

describe('rate limiting', () => {
  it('allows exactly the limit inside one window, then rejects', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')

    for (let i = 0; i < RATE_LIMIT_MESSAGES; i++) harness.chats.send('a', `m${i}`)
    expect(harness.emitter.count('b', ServerEvent.chatMessage)).toBe(RATE_LIMIT_MESSAGES)

    expect(() => harness.chats.send('a', 'one too many')).toThrowError(
      expect.objectContaining({ code: ErrorCode.rateLimited }),
    )
    expect(harness.emitter.count('b', ServerEvent.chatMessage)).toBe(RATE_LIMIT_MESSAGES)
  })

  it('lets the window roll forward instead of resetting on a fixed tick', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')

    for (let i = 0; i < RATE_LIMIT_MESSAGES; i++) harness.chats.send('a', `m${i}`)

    // Only most of the window has passed, so the limit still holds.
    harness.advance(RATE_LIMIT_WINDOW_MS - 1)
    expect(() => harness.chats.send('a', 'still limited')).toThrowError(
      expect.objectContaining({ code: ErrorCode.rateLimited }),
    )

    // The oldest send has now aged out, so one slot frees up.
    harness.advance(2)
    expect(() => harness.chats.send('a', 'allowed again')).not.toThrow()
  })

  it('checks the limit before validating, so a flood of junk still costs quota', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')

    for (let i = 0; i < RATE_LIMIT_MESSAGES; i++) {
      expect(() => harness.chats.send('a', '   ')).toThrowError(
        expect.objectContaining({ code: ErrorCode.messageEmpty }),
      )
    }

    // The five junk sends each consumed a slot even though none was delivered,
    // so a well-formed message is now refused for the reason that will actually
    // stop the flood.
    expect(() => harness.chats.send('a', 'real message')).toThrowError(
      expect.objectContaining({ code: ErrorCode.rateLimited }),
    )
  })

  it('limits per socket, so one flooder cannot lock out their partner', () => {
    const harness = createHarness()
    connect(harness, 'flooder')
    connect(harness, 'victim')
    matchPair(harness, 'flooder', 'victim')

    for (let i = 0; i < RATE_LIMIT_MESSAGES; i++) harness.chats.send('flooder', `m${i}`)
    expect(() => harness.chats.send('flooder', 'over')).toThrowError(
      expect.objectContaining({ code: ErrorCode.rateLimited }),
    )

    expect(() => harness.chats.send('victim', 'hello')).not.toThrow()
    // Five of the flooder's messages plus the victim's own echo. The victim is
    // never blocked by someone else's flood.
    expect(harness.emitter.count('victim', ServerEvent.chatMessage)).toBe(RATE_LIMIT_MESSAGES + 1)
  })

  it('releases the quota when the socket goes away', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')

    for (let i = 0; i < RATE_LIMIT_MESSAGES; i++) harness.chats.send('a', `m${i}`)
    expect(() => harness.chats.send('a', 'blocked')).toThrow()

    harness.chats.forget('a')

    expect(() => harness.chats.send('a', 'fresh start')).not.toThrow()
  })
})

describe('chat:typing', () => {
  it('forwards to the partner only, never back to the sender', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')
    harness.emitter.clear()

    harness.chats.typing('a', true)

    expect(harness.emitter.payloads('b', ServerEvent.chatTyping)).toEqual([{ isTyping: true }])
    expect(harness.emitter.count('a', ServerEvent.chatTyping)).toBe(0)
  })

  it('carries the stop signal as well as the start', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')
    harness.emitter.clear()

    harness.chats.typing('a', true)
    harness.chats.typing('a', false)

    expect(harness.emitter.payloads('b', ServerEvent.chatTyping)).toEqual([
      { isTyping: true },
      { isTyping: false },
    ])
  })

  it('is not rate limited, since it fires on every keystroke', () => {
    const harness = createHarness()
    connect(harness, 'a')
    connect(harness, 'b')
    matchPair(harness, 'a', 'b')
    harness.emitter.clear()

    for (let i = 0; i < 60; i++) harness.chats.typing('a', true)

    expect(harness.emitter.count('b', ServerEvent.chatTyping)).toBe(60)
  })

  it('rejects typing when not in a chat', () => {
    const harness = createHarness()
    connect(harness, 'lonely')

    expect(() => harness.chats.typing('lonely', true)).toThrowError(
      expect.objectContaining({ code: ErrorCode.notInChat }),
    )
  })
})
