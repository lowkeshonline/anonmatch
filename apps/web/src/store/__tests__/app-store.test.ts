import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientEvent,
  MAX_MESSAGE_LENGTH,
  RATE_LIMIT_MESSAGES,
  RATE_LIMIT_WINDOW_MS,
  type ServerSignal,
} from '@anonmatch/shared'
import { useAppStore } from '../app-store'
import { emitToServer } from '../../lib/socket'

// The socket is the only thing that would leave the process, so it is the only
// thing replaced. `@anonmatch/shared` is deliberately not mocked: the rate
// window is one of the behaviours under test, and faking the constants it is
// compared against would make the test assert nothing.
vi.mock('../../lib/socket', () => ({
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
  emitToServer: vi.fn(() => true),
}))

const emitToServerMock = vi.mocked(emitToServer)

const T0 = 1_700_000_000_000

/** Drives the store to a known idle baseline, socket up. */
function givenIdle(): void {
  useAppStore.setState({
    status: 'idle',
    roomId: null,
    connectionError: null,
    online: 0,
    lastError: null,
  })
}

function signal(signal: ServerSignal): void {
  useAppStore.getState().applyServerSignal(signal)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  emitToServerMock.mockReset()
  emitToServerMock.mockReturnValue(true)
})

afterEach(() => {
  // `signOut` is the only public path that clears the store's non-reactive
  // send-rate mirror, so it doubles as the reset between tests. It also drops
  // the baseline back to `unauthenticated`, which every test overrides.
  useAppStore.getState().signOut()
  vi.useRealTimers()
})

describe('applyServerSignal: connected', () => {
  it('re-joins the queue when a reconnect lands while searching', () => {
    givenIdle()
    signal({ type: 'queue:waiting', payload: {} })
    emitToServerMock.mockClear()

    signal({ type: 'connected' })

    expect(emitToServerMock).toHaveBeenCalledWith(ClientEvent.queueJoin)
    expect(useAppStore.getState().status).toBe('searching')
  })

  it('ends the chat when a reconnect lands while chatting', () => {
    givenIdle()
    signal({ type: 'match:found', payload: { roomId: 'room-1' } })
    signal({ type: 'chat:typing', payload: { isTyping: true } })
    signal({ type: 'disconnected' })

    signal({ type: 'connected' })

    expect(useAppStore.getState()).toMatchObject({
      status: 'ended',
      roomId: null,
      partnerTyping: false,
      endReason: 'disconnected',
      connectionError: null,
    })
  })
})

describe('applyServerSignal: disconnected', () => {
  it('surfaces a reconnecting error without leaving the current status', () => {
    givenIdle()
    signal({ type: 'queue:waiting', payload: {} })

    signal({ type: 'disconnected' })

    expect(useAppStore.getState().connectionError).not.toBeNull()
    expect(useAppStore.getState().status).toBe('searching')
  })
})

describe('applyServerSignal: happy path', () => {
  it('walks idle -> searching -> chatting on the queue and match signals', () => {
    givenIdle()

    signal({ type: 'queue:waiting', payload: {} })
    expect(useAppStore.getState().status).toBe('searching')

    signal({ type: 'match:found', payload: { roomId: 'room-1' } })
    expect(useAppStore.getState()).toMatchObject({
      status: 'chatting',
      roomId: 'room-1',
      partnerTyping: false,
      endReason: null,
      messages: [],
    })
  })

  it('replaces the optimistic copy when the server echoes the message back', () => {
    givenIdle()
    signal({ type: 'match:found', payload: { roomId: 'room-1' } })
    useAppStore.getState().sendMessage('hi')

    signal({
      type: 'chat:message',
      payload: { id: 'm1', text: 'hi', from: 'you', ts: T0 },
    })

    const { messages } = useAppStore.getState()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ id: 'm1', from: 'you' })
    expect(messages[0]?.pending).toBeUndefined()
  })
})

describe('sendMessage', () => {
  it('refuses and keeps state untouched when the socket cannot emit', () => {
    givenIdle()
    signal({ type: 'match:found', payload: { roomId: 'room-1' } })
    emitToServerMock.mockReturnValue(false)

    expect(useAppStore.getState().sendMessage('hello')).toBe(false)
    expect(useAppStore.getState().messages).toEqual([])
    expect(useAppStore.getState().cooldownUntil).toBe(0)
  })

  it('refuses an empty draft without emitting', () => {
    givenIdle()

    expect(useAppStore.getState().sendMessage('   ')).toBe(false)
    expect(emitToServerMock).not.toHaveBeenCalled()
  })

  it('refuses a draft over the shared length limit without emitting', () => {
    givenIdle()

    expect(useAppStore.getState().sendMessage('x'.repeat(MAX_MESSAGE_LENGTH + 1))).toBe(false)
    expect(emitToServerMock).not.toHaveBeenCalled()
  })

  it('emits and appends a pending message when the socket is up', () => {
    givenIdle()
    signal({ type: 'match:found', payload: { roomId: 'room-1' } })

    expect(useAppStore.getState().sendMessage('  hello  ')).toBe(true)
    expect(emitToServerMock).toHaveBeenCalledWith(ClientEvent.chatMessage, { text: 'hello' })

    const { messages } = useAppStore.getState()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ text: 'hello', from: 'you', ts: T0, pending: true })
  })

  it('stops the typing indicator on a successful send', () => {
    givenIdle()

    useAppStore.getState().sendMessage('hello')

    expect(emitToServerMock).toHaveBeenCalledWith(ClientEvent.chatTyping, { isTyping: false })
  })
})

describe('sendMessage: local send-rate mirror', () => {
  it('refuses the send past the shared rate limit inside one window', () => {
    givenIdle()

    for (let n = 1; n <= RATE_LIMIT_MESSAGES; n += 1) {
      expect(useAppStore.getState().sendMessage(`m${n}`)).toBe(true)
    }
    expect(useAppStore.getState().sendMessage(`m${RATE_LIMIT_MESSAGES + 1}`)).toBe(false)
  })

  it('leaves the composer alone until the window is actually full', () => {
    givenIdle()
    useAppStore.getState().sendMessage('first')

    expect(useAppStore.getState().cooldownUntil).toBe(0)

    for (let n = 1; n < RATE_LIMIT_MESSAGES; n += 1) useAppStore.getState().sendMessage('m')

    expect(useAppStore.getState().cooldownUntil).toBe(T0 + RATE_LIMIT_WINDOW_MS)
  })

  it('allows sending again once the window has rolled past the oldest send', () => {
    givenIdle()
    for (let n = 0; n < RATE_LIMIT_MESSAGES; n += 1) useAppStore.getState().sendMessage('m')
    expect(useAppStore.getState().sendMessage('late')).toBe(false)

    vi.advanceTimersByTime(RATE_LIMIT_WINDOW_MS + 1)

    expect(useAppStore.getState().sendMessage('late')).toBe(true)
  })
})
