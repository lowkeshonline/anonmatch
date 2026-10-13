import { createServer, type Server as HttpServer } from 'node:http'
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ErrorCode,
  ServerEvent,
  type ChatMessageOutbound,
  type ClientToServerEvents,
  type ErrorPayload,
  type MatchFoundPayload,
  type ServerToClientEvents,
} from '@anonmatch/shared'
import { ChatService } from '../../services/chat-service.js'
import { MatchmakingService } from '../../services/matchmaking-service.js'
import { SessionService } from '../../services/session-service.js'
import { InMemoryAuthSessionStore } from '../../stores/auth-session-store.js'
import { InMemoryPresenceStore } from '../../stores/presence-store.js'
import { InMemoryQueueStore } from '../../stores/queue-store.js'
import { InMemorySessionStore } from '../../stores/session-store.js'
import { createSocketServer, type ChatServer } from '../socket.js'
import { SocketEmitter } from '../socket-emitter.js'

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>

/**
 * Records everything a client receives.
 *
 * Unit tests cover the rules; this file covers the wiring that unit tests cannot
 * reach. Socket.IO payload shape, the handshake, per-socket delivery and the
 * disconnect handler are all only visible over a real connection, and every one
 * of them has broken a working app at some point.
 */
interface Inbox {
  count(event: string): number
  payloads<T>(event: string): T[]
  latest<T>(event: string): T | undefined
  /** Resolves on the *next* occurrence, so a waiter registered too late hangs. */
  next<T>(event: string, timeoutMs?: number): Promise<T>
  /** Lets everything in flight land, then asserts on what arrived. */
  settle(ms?: number): Promise<void>
}

interface TestServer {
  readonly url: string
  readonly httpServer: HttpServer
  readonly io: ChatServer
  readonly authSessions: InMemoryAuthSessionStore
  close(): Promise<void>
}

const SERVER_EVENT_NAMES: readonly string[] = Object.values(ServerEvent)

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    if (cleanup !== undefined) await cleanup()
  }
})

const settle = (ms = 120) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function startServer(sessionTtlMs = 60_000): Promise<TestServer> {
  const authSessions = new InMemoryAuthSessionStore(sessionTtlMs)
  const presence = new InMemoryPresenceStore()
  const queue = new InMemoryQueueStore()
  const store = new InMemorySessionStore()

  const emitter = new SocketEmitter()
  const now = () => Date.now()
  const sessions = new SessionService({ store, emitter, now })
  const matchmaking = new MatchmakingService({ queue, sessions, emitter, now })
  const chats = new ChatService({ sessions, emitter, now })

  const httpServer = createServer((_req, res) => {
    res.writeHead(404).end()
  })
  const io = createSocketServer(httpServer, {
    config: {
      env: 'test',
      host: '127.0.0.1',
      port: 0,
      corsOrigins: ['http://localhost:5173'],
      googleClientId: 'test',
      sessionTtlMs: 60_000,
    },
    authSessions,
    presence,
    matchmaking,
    sessions,
    chats,
    emitter,
  })

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const address = httpServer.address()
  if (address === null || typeof address === 'string') {
    throw new Error('server did not bind a port')
  }

  const server: TestServer = {
    url: `http://127.0.0.1:${address.port}`,
    httpServer,
    io,
    authSessions,
    close: () =>
      new Promise<void>((resolve) => {
        void io.close(() => {
          void httpServer.close(() => resolve())
        })
      }),
  }

  cleanups.push(() => server.close())
  return server
}

function tokenFor(server: TestServer, identityId: string): string {
  const session = server.authSessions.create(
    {
      id: identityId,
      email: `${identityId.replace(':', '-')}@test.local`,
      name: identityId,
      picture: null,
    },
    Date.now(),
  )
  return session.token
}

/** Connects one authenticated client and starts recording what it receives. */
async function openClient(
  server: TestServer,
  identityId: string,
): Promise<{ socket: TestClient; inbox: Inbox }> {
  const socket: TestClient = connectClient(server.url, {
    auth: { token: tokenFor(server, identityId) },
    transports: ['websocket'],
  })

  const log: Array<{ event: string; payload: unknown }> = []
  const waiters = new Map<string, Array<(payload: unknown) => void>>()

  for (const event of SERVER_EVENT_NAMES) {
    socket.on(
      event as never,
      ((payload: unknown) => {
        log.push({ event, payload })

        const waiting = waiters.get(event)
        if (waiting !== undefined) {
          waiters.delete(event)
          for (const resolve of waiting) resolve(payload)
        }
      }) as never,
    )
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('client failed to connect')), 5_000)
    socket.on('connect', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.on('connect_error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })

  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        if (socket.connected) {
          socket.on('disconnect', () => resolve())
          socket.close()
        } else {
          socket.close()
          resolve()
        }
      }),
  )

  const inbox: Inbox = {
    count: (event) => log.filter((entry) => entry.event === event).length,
    payloads: <T>(event: string) =>
      log.filter((entry) => entry.event === event).map((entry) => entry.payload as T),
    latest: <T>(event: string) => {
      const all = log.filter((entry) => entry.event === event)
      return all.at(-1)?.payload as T | undefined
    },
    next: <T>(event: string, timeoutMs = 5_000) =>
      new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          const waiting = waiters.get(event) ?? []
          waiters.set(
            event,
            waiting.filter((entry) => entry !== resolver),
          )
          reject(new Error(`timed out after ${timeoutMs}ms waiting for ${event}`))
        }, timeoutMs)

        const resolver = (payload: unknown) => {
          clearTimeout(timer)
          resolve(payload as T)
        }

        waiters.set(event, [...(waiters.get(event) ?? []), resolver])
      }),
    settle: (ms) => settle(ms),
  }

  return { socket, inbox }
}

/** Connects without a token and returns the code the server refused with. */
async function expectRejected(url: string, token?: string): Promise<string> {
  const socket = connectClient(url, {
    ...(token === undefined ? {} : { auth: { token } }),
    transports: ['websocket'],
  })

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server never refused the connection')), 5_000)
    socket.on('connect', () => {
      clearTimeout(timer)
      socket.close()
      reject(new Error('server accepted a connection it should have refused'))
    })
    socket.on('connect_error', (error: Error & { data?: { code?: string } }) => {
      clearTimeout(timer)
      resolve(error.data?.code ?? 'NO_CODE')
    })
  })

  socket.close()
  return code
}

describe('two clients, end to end', () => {
  it('matches, chats, skips and leaves over real sockets', async () => {
    const server = await startServer()
    const alice = await openClient(server, 'google:alice')
    const bob = await openClient(server, 'google:bob')

    // Both join. Each gets queue:waiting, and each is told who it matched with.
    const aliceWaiting = alice.inbox.next(ServerEvent.queueWaiting)
    const aliceMatched = alice.inbox.next<MatchFoundPayload>(ServerEvent.matchFound)
    alice.socket.emit('queue:join')
    await aliceWaiting

    const bobWaiting = bob.inbox.next(ServerEvent.queueWaiting)
    const bobMatched = bob.inbox.next<MatchFoundPayload>(ServerEvent.matchFound)
    bob.socket.emit('queue:join')
    await bobWaiting

    const [aliceRoom, bobRoom] = await Promise.all([aliceMatched, bobMatched])
    expect(aliceRoom.roomId).toBe(bobRoom.roomId)
    expect(aliceRoom.roomId).not.toBe('')

    // A message reaches both sides, labelled relative to whoever reads it.
    const aliceSees = alice.inbox.next<ChatMessageOutbound>(ServerEvent.chatMessage)
    const bobSees = bob.inbox.next<ChatMessageOutbound>(ServerEvent.chatMessage)
    alice.socket.emit('chat:message', { text: '  hello bob  ' })
    const [mine, theirs] = await Promise.all([aliceSees, bobSees])

    expect(mine.from).toBe('you')
    expect(theirs.from).toBe('stranger')
    expect(theirs.text).toBe('hello bob')
    expect(mine.id).toBe(theirs.id)
    expect(mine.ts).toBe(theirs.ts)

    // Typing goes to the partner only.
    const bobSeesTyping = bob.inbox.next(ServerEvent.chatTyping)
    alice.socket.emit('chat:typing', { isTyping: true })
    expect(await bobSeesTyping).toEqual({ isTyping: true })
    await alice.inbox.settle()
    expect(alice.inbox.count(ServerEvent.chatTyping)).toBe(0)

    // Skip: the partner is told and ends, the skipper goes back to waiting.
    const bobTold = bob.inbox.next<{ reason: string }>(ServerEvent.chatPartnerLeft)
    const aliceWaitingAgain = alice.inbox.next(ServerEvent.queueWaiting)
    alice.socket.emit('chat:skip')

    expect(await bobTold).toEqual({ reason: 'skipped' })
    await aliceWaitingAgain
    await alice.inbox.settle()

    expect(alice.inbox.count(ServerEvent.chatPartnerLeft)).toBe(0)

    // Alice really is back in the queue: a newcomer pairs with her immediately.
    const carol = await openClient(server, 'google:carol')
    const aliceRematched = alice.inbox.next<MatchFoundPayload>(ServerEvent.matchFound)
    const carolMatched = carol.inbox.next<MatchFoundPayload>(ServerEvent.matchFound)
    carol.socket.emit('queue:join')

    const [aliceRoom2, carolRoom] = await Promise.all([aliceRematched, carolMatched])
    expect(aliceRoom2.roomId).toBe(carolRoom.roomId)
    expect(aliceRoom2.roomId).not.toBe(aliceRoom.roomId)
  })

  it('tells the partner when someone disconnects mid-chat', async () => {
    const server = await startServer()
    const alice = await openClient(server, 'google:alice')
    const bob = await openClient(server, 'google:bob')

    const aliceMatched = alice.inbox.next(ServerEvent.matchFound)
    alice.socket.emit('queue:join')
    const bobMatched = bob.inbox.next(ServerEvent.matchFound)
    bob.socket.emit('queue:join')
    await Promise.all([aliceMatched, bobMatched])

    const bobTold = bob.inbox.next<{ reason: string }>(ServerEvent.chatPartnerLeft)
    alice.socket.close()

    expect(await bobTold).toEqual({ reason: 'disconnected' })
    await bob.inbox.settle()
    // Still exactly one match: a disconnect ends the chat, it does not silently
    // re-pair the survivor with nobody.
    expect(bob.inbox.count(ServerEvent.matchFound)).toBe(1)
  })

  it('frees the partner when someone leaves a chat outright', async () => {
    const server = await startServer()
    const alice = await openClient(server, 'google:alice')
    const bob = await openClient(server, 'google:bob')

    const aliceMatched = alice.inbox.next(ServerEvent.matchFound)
    alice.socket.emit('queue:join')
    const bobMatched = bob.inbox.next(ServerEvent.matchFound)
    bob.socket.emit('queue:join')
    await Promise.all([aliceMatched, bobMatched])

    const aliceTold = alice.inbox.next<{ reason: string }>(ServerEvent.chatPartnerLeft)
    bob.socket.emit('chat:leave')
    expect(await aliceTold).toEqual({ reason: 'left' })

    // Alice can move on, and is matched with the next arrival rather than
    // waiting forever on a room that was already torn down.
    const carol = await openClient(server, 'google:carol')
    const aliceRematched = alice.inbox.next<MatchFoundPayload>(ServerEvent.matchFound)
    const carolMatched = carol.inbox.next<MatchFoundPayload>(ServerEvent.matchFound)
    alice.socket.emit('queue:join')
    carol.socket.emit('queue:join')

    const [aliceRoom, carolRoom] = await Promise.all([aliceRematched, carolMatched])
    expect(aliceRoom.roomId).toBe(carolRoom.roomId)
  })

  it('cancels a wait that was never satisfied', async () => {
    const server = await startServer()
    const alice = await openClient(server, 'google:alice')

    const waiting = alice.inbox.next(ServerEvent.queueWaiting)
    alice.socket.emit('queue:join')
    await waiting

    alice.socket.emit('queue:leave')
    await alice.inbox.settle()

    const failed = alice.inbox.next<ErrorPayload>(ServerEvent.error)
    alice.socket.emit('queue:leave')
    expect((await failed).code).toBe(ErrorCode.illegalTransition)

    // Rejoining after a cancel works, so the cancel did not strand her.
    const requeued = alice.inbox.next(ServerEvent.queueWaiting)
    alice.socket.emit('queue:join')
    await requeued
  })

  it('refuses a socket whose tab disconnects while queued, leaving nobody stranded', async () => {
    const server = await startServer()
    const alice = await openClient(server, 'google:alice')

    const waiting = alice.inbox.next(ServerEvent.queueWaiting)
    alice.socket.emit('queue:join')
    await waiting

    alice.socket.close()
    await settle()

    const bob = await openClient(server, 'google:bob')
    const carol = await openClient(server, 'google:carol')

    const bobMatched = bob.inbox.next<MatchFoundPayload>(ServerEvent.matchFound)
    const carolMatched = carol.inbox.next<MatchFoundPayload>(ServerEvent.matchFound)
    bob.socket.emit('queue:join')
    await bob.inbox.next(ServerEvent.queueWaiting)
    carol.socket.emit('queue:join')

    const [bobRoom, carolRoom] = await Promise.all([bobMatched, carolMatched])
    expect(bobRoom.roomId).toBe(carolRoom.roomId)
  })
})

describe('payload validation at the boundary', () => {
  it('rejects a message that is not a string', async () => {
    const server = await startServer()
    const alice = await openClient(server, 'google:alice')
    const bob = await openClient(server, 'google:bob')

    const aliceMatched = alice.inbox.next(ServerEvent.matchFound)
    alice.socket.emit('queue:join')
    const bobMatched = bob.inbox.next(ServerEvent.matchFound)
    bob.socket.emit('queue:join')
    await Promise.all([aliceMatched, bobMatched])

    const failed = alice.inbox.next<ErrorPayload>(ServerEvent.error)
    alice.socket.emit('chat:message', { text: 42 } as never)

    expect((await failed).code).toBe(ErrorCode.invalidPayload)
    await bob.inbox.settle()
    expect(bob.inbox.count(ServerEvent.chatMessage)).toBe(0)
  })

  it('rejects an unexpected extra field rather than ignoring it', async () => {
    const server = await startServer()
    const alice = await openClient(server, 'google:alice')

    const failed = alice.inbox.next<ErrorPayload>(ServerEvent.error)
    alice.socket.emit('chat:message', { text: 'hi', roomId: 'someone-elses-room' } as never)

    expect((await failed).code).toBe(ErrorCode.invalidPayload)
  })

  it('rejects a payload on an event that takes none', async () => {
    const server = await startServer()
    const alice = await openClient(server, 'google:alice')

    const failed = alice.inbox.next<ErrorPayload>(ServerEvent.error)
    alice.socket.emit('queue:join', { force: true })

    expect((await failed).code).toBe(ErrorCode.invalidPayload)
    await alice.inbox.settle()
    expect(alice.inbox.count(ServerEvent.queueWaiting)).toBe(0)
  })
})

describe('illegal transitions over the wire', () => {
  it('reports ALREADY_QUEUED on a second queue:join', async () => {
    const server = await startServer()
    const alice = await openClient(server, 'google:alice')

    const waiting = alice.inbox.next(ServerEvent.queueWaiting)
    alice.socket.emit('queue:join')
    await waiting

    const failed = alice.inbox.next<ErrorPayload>(ServerEvent.error)
    alice.socket.emit('queue:join')

    expect((await failed).code).toBe(ErrorCode.alreadyQueued)
  })

  it('reports NOT_IN_CHAT for a message sent outside a chat', async () => {
    const server = await startServer()
    const alice = await openClient(server, 'google:alice')

    const failed = alice.inbox.next<ErrorPayload>(ServerEvent.error)
    alice.socket.emit('chat:message', { text: 'anyone out there?' })

    expect((await failed).code).toBe(ErrorCode.notInChat)
  })

  it('reports ILLEGAL_TRANSITION when queueing while already chatting', async () => {
    const server = await startServer()
    const alice = await openClient(server, 'google:alice')
    const bob = await openClient(server, 'google:bob')

    const aliceMatched = alice.inbox.next(ServerEvent.matchFound)
    alice.socket.emit('queue:join')
    const bobMatched = bob.inbox.next(ServerEvent.matchFound)
    bob.socket.emit('queue:join')
    await Promise.all([aliceMatched, bobMatched])

    const failed = alice.inbox.next<ErrorPayload>(ServerEvent.error)
    alice.socket.emit('queue:join')

    expect((await failed).code).toBe(ErrorCode.illegalTransition)
  })

  it('keeps the server alive through a burst of invalid traffic', async () => {
    const server = await startServer()
    const alice = await openClient(server, 'google:alice')
    const bob = await openClient(server, 'google:bob')

    const aliceMatched = alice.inbox.next(ServerEvent.matchFound)
    alice.socket.emit('queue:join')
    const bobMatched = bob.inbox.next(ServerEvent.matchFound)
    bob.socket.emit('queue:join')
    await Promise.all([aliceMatched, bobMatched])

    for (const junk of [{ text: 42 }, {}, { text: 'x', extra: true }, null, 'a string', 7]) {
      alice.socket.emit('chat:message', junk as never)
    }
    alice.socket.emit('chat:skip', { force: true })
    alice.socket.emit('queue:join', 'unexpected')
    await alice.inbox.settle()

    // Every one of those was refused and nothing was delivered, yet the
    // connection still works: a burst of hostile traffic must not take down the
    // handler or the process.
    expect(alice.inbox.count(ServerEvent.error)).toBe(8)
    expect(alice.inbox.count(ServerEvent.chatMessage)).toBe(0)

    // Alice is still in the chat with bob, so a well-formed skip must still work
    // and still leave the state machine consistent.
    const bobTold = bob.inbox.next<{ reason: string }>(ServerEvent.chatPartnerLeft)
    alice.socket.emit('chat:skip')
    expect((await bobTold).reason).toBe('skipped')

    const carol = await openClient(server, 'google:carol')
    const aliceRematched = alice.inbox.next<MatchFoundPayload>(ServerEvent.matchFound)
    carol.socket.emit('queue:join')

    expect((await aliceRematched).roomId).toBeDefined()
  })
})

describe('message rules over the wire', () => {
  it('enforces the rate limit and says so', async () => {
    const server = await startServer()
    const alice = await openClient(server, 'google:alice')
    const bob = await openClient(server, 'google:bob')

    const aliceMatched = alice.inbox.next(ServerEvent.matchFound)
    alice.socket.emit('queue:join')
    const bobMatched = bob.inbox.next(ServerEvent.matchFound)
    bob.socket.emit('queue:join')
    await Promise.all([aliceMatched, bobMatched])

    const failed = alice.inbox.next<ErrorPayload>(ServerEvent.error)
    for (let i = 0; i < 7; i++) alice.socket.emit('chat:message', { text: `m${i}` })

    expect((await failed).code).toBe(ErrorCode.rateLimited)
    expect(bob.inbox.count(ServerEvent.chatMessage)).toBeLessThanOrEqual(5)
  })

  it('rejects an over-long message with the specific code, not a generic one', async () => {
    const server = await startServer()
    const alice = await openClient(server, 'google:alice')
    const bob = await openClient(server, 'google:bob')

    const aliceMatched = alice.inbox.next(ServerEvent.matchFound)
    alice.socket.emit('queue:join')
    const bobMatched = bob.inbox.next(ServerEvent.matchFound)
    bob.socket.emit('queue:join')
    await Promise.all([aliceMatched, bobMatched])

    const failed = alice.inbox.next<ErrorPayload>(ServerEvent.error)
    alice.socket.emit('chat:message', { text: 'x'.repeat(501) })

    expect((await failed).code).toBe(ErrorCode.messageTooLong)
  })

  it('drops a whitespace-only message instead of sending a blank bubble', async () => {
    const server = await startServer()
    const alice = await openClient(server, 'google:alice')
    const bob = await openClient(server, 'google:bob')

    const aliceMatched = alice.inbox.next(ServerEvent.matchFound)
    alice.socket.emit('queue:join')
    const bobMatched = bob.inbox.next(ServerEvent.matchFound)
    bob.socket.emit('queue:join')
    await Promise.all([aliceMatched, bobMatched])

    const failed = alice.inbox.next<ErrorPayload>(ServerEvent.error)
    alice.socket.emit('chat:message', { text: '     ' })

    expect((await failed).code).toBe(ErrorCode.messageEmpty)
    await bob.inbox.settle()
    expect(bob.inbox.count(ServerEvent.chatMessage)).toBe(0)
  })
})

describe('handshake', () => {
  it('refuses a connection with no token', async () => {
    const server = await startServer()

    expect(await expectRejected(server.url)).toBe(ErrorCode.notAuthenticated)
  })

  it('refuses a connection with a token the server never issued', async () => {
    const server = await startServer()

    expect(await expectRejected(server.url, 'made-up-token')).toBe(ErrorCode.notAuthenticated)
  })

  it('refuses a token whose session has already expired', async () => {
    // A negative TTL mints tokens that are born expired, which is the same
    // branch the real TTL timer reaches.
    const server = await startServer(-1)
    const token = tokenFor(server, 'google:alice')

    expect(await expectRejected(server.url, token)).toBe(ErrorCode.notAuthenticated)
  })
})
