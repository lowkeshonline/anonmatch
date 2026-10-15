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
import type { Config } from '../config.js'
import { AuthService } from '../services/auth-service.js'
import { createChatServer, type ChatServerApp } from '../server.js'

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>

/**
 * The M2 acceptance test: a full chat, over real sockets, against the real
 * composition in `server.ts`.
 *
 * The other flow test builds the service graph by hand. This one deliberately
 * does not, because the wiring in `server.ts` is exactly the part that cannot be
 * verified any other way: if a service were pointed at the wrong store, or the
 * emitter never bound to Socket.IO, every hand-built test would still pass while
 * the running app matched nobody.
 *
 * Sessions are minted straight from the store rather than through Google, so
 * this covers matchmaking and chat, which is what M2 is about. Google sign-in is
 * covered by the auth tests.
 */
const testConfig: Config = {
  env: 'test',
  host: '127.0.0.1',
  port: 0,
  corsOrigins: ['http://localhost:5173'],
  googleClientId: 'test-client-id',
  sessionTtlMs: 60_000,
}

const cleanups: Array<() => Promise<void>> = []
let app: ChatServerApp | null = null
let baseUrl = ''

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    if (cleanup !== undefined) await cleanup()
  }
  if (app !== null) {
    await app.close()
    app = null
  }
})

interface Inbox {
  count(event: string): number
  payloads<T>(event: string): T[]
  next<T>(event: string, timeoutMs?: number): Promise<T>
  settle(ms?: number): Promise<void>
}

const settle = (ms = 150) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function boot(): Promise<ChatServerApp> {
  const authService = new AuthService({
    googleClientId: 'test-client-id',
    // Never invoked: tokens are minted from the store instead of via Google.
    isEmailAllowed: () => true,
  })

  app = createChatServer({ config: testConfig, authService })
  const port = await app.listen()
  baseUrl = `http://127.0.0.1:${port}`
  return app
}

async function connectAs(identityId: string): Promise<{ socket: TestClient; inbox: Inbox }> {
  const server = app
  if (server === null) throw new Error('server not booted')

  const token = server.authSessions.create(
    { id: identityId, email: `${identityId}@test.local`, name: identityId, picture: null },
    Date.now(),
  ).token

  const socket: TestClient = connectClient(baseUrl, {
    auth: { token },
    transports: ['websocket'],
  })

  const seen: Array<{ event: string; payload: unknown }> = []
  const waiters = new Map<string, Array<(payload: unknown) => void>>()

  for (const event of Object.values(ServerEvent)) {
    socket.on(
      event as never,
      ((payload: unknown) => {
        seen.push({ event, payload })
        const waiting = waiters.get(event)
        if (waiting !== undefined) {
          waiters.delete(event)
          for (const resolve of waiting) resolve(payload)
        }
      }) as never,
    )
  }

  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        socket.close()
        resolve()
      }),
  )

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

  return {
    socket,
    inbox: {
      count: (event) => seen.filter((entry) => entry.event === event).length,
      payloads: <T>(event: string) =>
        seen.filter((entry) => entry.event === event).map((entry) => entry.payload as T),
      next: <T>(event: string, timeoutMs = 5_000) =>
        new Promise<T>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`timed out after ${timeoutMs}ms waiting for ${event}`)),
            timeoutMs,
          )
          const resolver = (payload: unknown) => {
            clearTimeout(timer)
            resolve(payload as T)
          }
          waiters.set(event, [...(waiters.get(event) ?? []), resolver])
        }),
      settle,
    },
  }
}

describe('the assembled server', () => {
  it('serves the health route', async () => {
    await boot()

    const response = await fetch(`${baseUrl}/health`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ok' })
  })

  it('completes a full chat between two real clients', async () => {
    await boot()
    const alice = await connectAs('google:alice')
    const bob = await connectAs('google:bob')

    const aliceMatched = alice.inbox.next<MatchFoundPayload>(ServerEvent.matchFound)
    const aliceWaiting = alice.inbox.next(ServerEvent.queueWaiting)
    alice.socket.emit('queue:join')
    await aliceWaiting

    const bobMatched = bob.inbox.next<MatchFoundPayload>(ServerEvent.matchFound)
    bob.socket.emit('queue:join')

    const [aliceRoom, bobRoom] = await Promise.all([aliceMatched, bobMatched])
    expect(aliceRoom.roomId).toBe(bobRoom.roomId)

    const aliceSees = alice.inbox.next<ChatMessageOutbound>(ServerEvent.chatMessage)
    const bobSees = bob.inbox.next<ChatMessageOutbound>(ServerEvent.chatMessage)
    bob.socket.emit('chat:message', { text: 'hi alice' })

    const [fromBob, fromAlice] = await Promise.all([aliceSees, bobSees])
    expect(fromBob.from).toBe('stranger')
    expect(fromAlice.from).toBe('you')
    expect(fromAlice.text).toBe('hi alice')

    const aliceSeesTyping = bob.inbox.next(ServerEvent.chatTyping)
    alice.socket.emit('chat:typing', { isTyping: true })
    await aliceSeesTyping

    // Skip, then confirm the skipper is really back in the queue by matching
    // her with someone who arrives afterwards.
    const bobTold = bob.inbox.next<{ reason: string }>(ServerEvent.chatPartnerLeft)
    alice.socket.emit('chat:skip')
    expect(await bobTold).toEqual({ reason: 'skipped' })

    const carol = await connectAs('google:carol')
    const aliceRematched = alice.inbox.next<MatchFoundPayload>(ServerEvent.matchFound)
    const carolMatched = carol.inbox.next<MatchFoundPayload>(ServerEvent.matchFound)
    carol.socket.emit('queue:join')

    const [aliceRoom2, carolRoom] = await Promise.all([aliceRematched, carolMatched])
    expect(aliceRoom2.roomId).toBe(carolRoom.roomId)
    expect(aliceRoom2.roomId).not.toBe(aliceRoom.roomId)
  })

  it('reports an illegal action instead of dropping the connection', async () => {
    await boot()
    const alice = await connectAs('google:alice')

    const failed = alice.inbox.next<ErrorPayload>(ServerEvent.error)
    alice.socket.emit('chat:message', { text: 'hello?' })

    expect((await failed).code).toBe(ErrorCode.notInChat)
    // The socket survived the refusal, which is what keeps a double click from
    // turning into a silent dead connection.
    expect(alice.socket.connected).toBe(true)
  })

  it('rate limits the google auth endpoint', async () => {
    await boot()

    // A junk credential is refused by Google (or by us) without ever reaching a
    // real account, so this hammers the endpoint the way a script would.
    const attempt = () =>
      fetch(`${baseUrl}/api/auth/google`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential: 'not-a-real-token' }),
      })

    for (let i = 0; i < 10; i += 1) await attempt()

    const limited = await attempt()
    expect(limited.status).toBe(429)
    const body = (await limited.json()) as { error: string }
    expect(body.error).toBe(ErrorCode.rateLimited)
  })

  it('counts distinct identities rather than sockets', async () => {
    await boot()
    const alice = await connectAs('google:alice')
    const secondTab = await connectAs('google:alice')
    await secondTab.inbox.settle()

    // Two tabs, one person. Asserted from what was received rather than awaited,
    // because the broadcast lands while the connection is still settling.
    const aliceCounts = alice.inbox.payloads<{ online: number }>(ServerEvent.presenceCount)
    const tabCounts = secondTab.inbox.payloads<{ online: number }>(ServerEvent.presenceCount)

    expect(aliceCounts.length).toBeGreaterThan(0)
    expect(tabCounts.at(-1)?.online).toBe(1)
    // The number went up on the second connection but not above one.
    expect(aliceCounts.at(-1)?.online).toBe(1)
  })
})
