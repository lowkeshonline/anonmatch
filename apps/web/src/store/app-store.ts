import { create } from 'zustand'
import {
  ClientEvent,
  ErrorCode,
  MAX_MESSAGE_LENGTH,
  RATE_LIMIT_MESSAGES,
  RATE_LIMIT_WINDOW_MS,
  type ChatMessageOutbound,
  type ChatPartnerLeftReason,
  type CurrentUser,
  type ErrorPayload,
  type ServerSignal,
} from '@anonmatch/shared'
import { postJson } from '../lib/api'
import { connectSocket, disconnectSocket, emitToServer } from '../lib/socket'
import { sessionStorage } from '../lib/session-storage'

/**
 * Mirrors the server-authoritative lifecycle from the shared contract.
 * `unauthenticated` is the extra state that auth adds in front of `idle`;
 * without it the app cannot tell "show sign-in" from "show landing".
 */
export type AppStatus = 'unauthenticated' | 'idle' | 'searching' | 'chatting' | 'ended'

/**
 * A message as the chat screen needs it. `pending` marks the optimistic copy
 * that is on screen between pressing send and the server echoing it back with
 * its own id; the reconciliation lives in `applyServerSignal`.
 */
export interface ChatMessageView {
  readonly id: string
  readonly text: string
  readonly from: 'you' | 'stranger'
  readonly ts: number
  readonly pending?: boolean
}

/** Reconnection delay before a `chat:typing` update is trusted again. */
const TYPING_THROTTLE_MS = 1_500
/** How long a typing indicator survives without a refresh from the partner. */
const TYPING_STALE_MS = 6_000

export interface AppStore {
  status: AppStatus
  user: CurrentUser | null
  roomId: string | null
  online: number
  isAuthenticating: boolean
  authError: string | null
  connectionError: string | null
  lastError: ErrorPayload | null

  messages: readonly ChatMessageView[]
  partnerTyping: boolean
  /** Why the last chat ended. `null` while a chat is running. */
  endReason: ChatPartnerLeftReason | null
  /** Epoch ms before which `sendMessage` refuses locally; 0 when free. */
  cooldownUntil: number

  bootstrap: () => void
  signIn: (credential: string) => Promise<void>
  signOut: () => void
  applyServerSignal: (signal: ServerSignal) => void

  startSearching: () => void
  cancelSearching: () => void
  restart: () => void
  skipPartner: () => void
  leaveChat: () => void
  /** Returns whether the message was actually emitted; the composer keeps the draft otherwise. */
  sendMessage: (text: string) => boolean
  setTyping: (isTyping: boolean) => void
  dismissError: () => void
}

function isCurrentUser(value: unknown): value is CurrentUser {
  if (typeof value !== 'object' || value === null) return false
  const { id, email, name } = value as Record<string, unknown>
  return typeof id === 'string' && typeof email === 'string' && typeof name === 'string'
}

function newLocalId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ? `local:${uuid}` : `local:${Date.now()}:${Math.random()}`
}

const emptyChat = {
  messages: [] as readonly ChatMessageView[],
  partnerTyping: false,
  endReason: null,
  cooldownUntil: 0,
}

export const useAppStore = create<AppStore>((set, get) => {
  // Non-reactive timers. They drive the typing throttle, the stale-indicator
  // reset, and the local mirror of the server's send-rate window, none of which
  // should force a re-render of anything on its own.
  let lastTypingSentAt = 0
  let recentSends: number[] = []
  let typingStaleTimer: ReturnType<typeof setTimeout> | null = null

  const clearTypingTimers = () => {
    if (typingStaleTimer !== null) {
      clearTimeout(typingStaleTimer)
      typingStaleTimer = null
    }
  }

  const setPartnerTyping = (isTyping: boolean) => {
    clearTypingTimers()
    set({ partnerTyping: isTyping })

    if (!isTyping) return

    // The partner can vanish without a final `false` — a closed tab, a lost
    // connection. Without this the dots would sit there forever.
    typingStaleTimer = setTimeout(() => set({ partnerTyping: false }), TYPING_STALE_MS)
  }

  const resetChat = () => {
    clearTypingTimers()
    lastTypingSentAt = 0
    set(emptyChat)
  }

  /**
   * Folds one outbound message into the list.
   *
   * The server echoes a sender's own message back with `from: 'you'` and the id
   * it assigned, so the optimistic copy is reconciled by replacing the oldest
   * still-pending entry rather than appending a duplicate. A `stranger`
   * message has nothing to reconcile and is appended.
   */
  const appendMessage = (message: ChatMessageOutbound) => {
    if (message.from === 'stranger') {
      set({ messages: [...get().messages, message] })
      setPartnerTyping(false)
      return
    }

    const messages = [...get().messages]
    const pendingAt = messages.findIndex((entry) => entry.pending === true)

    if (pendingAt === -1) {
      messages.push(message)
    } else {
      messages[pendingAt] = message
    }

    set({ messages })
  }

  return {
    status: 'unauthenticated',
    user: null,
    roomId: null,
    online: 0,
    isAuthenticating: false,
    authError: null,
    connectionError: null,
    lastError: null,
    ...emptyChat,

    /**
     * Reconnects from a stored session on load. A token without a matching user
     * record means the two got out of sync, so both are discarded rather than
     * half-restored.
     */
    bootstrap: () => {
      const token = sessionStorage.readToken()
      const user = sessionStorage.readUser()

      if (token === null || user === null) {
        if (token !== null || user !== null) sessionStorage.clear()
        set({ status: 'unauthenticated', user: null })
        return
      }

      set({ status: 'idle', user })
      connectSocket(token, (signal) => get().applyServerSignal(signal))
    },

    signIn: async (credential) => {
      set({ isAuthenticating: true, authError: null })

      const result = await postJson('/api/auth/google', { credential })

      if (!result.ok) {
        set({ isAuthenticating: false, authError: result.error.message })
        return
      }

      const payload = result.data
      const record: unknown = payload
      if (
        typeof record !== 'object' ||
        record === null ||
        !('token' in record) ||
        typeof record.token !== 'string' ||
        !('user' in record) ||
        !isCurrentUser(record.user)
      ) {
        set({ isAuthenticating: false, authError: 'The server sent a malformed response.' })
        return
      }

      const { token, user } = record as { token: string; user: CurrentUser }
      sessionStorage.write(token, user)
      set({ isAuthenticating: false, status: 'idle', user, authError: null })
      connectSocket(token, (signal) => get().applyServerSignal(signal))
    },

    signOut: () => {
      disconnectSocket()
      sessionStorage.clear()
      // The server's send quota is keyed by socket, so the local mirror only
      // needs clearing when the socket itself goes away.
      recentSends = []
      resetChat()
      set({
        status: 'unauthenticated',
        user: null,
        roomId: null,
        online: 0,
        authError: null,
        connectionError: null,
        lastError: null,
      })
    },

    /**
     * Every server signal funnels through here so the state transitions live in
     * one exhaustive switch rather than scattered across socket listeners.
     */
    applyServerSignal: (signal) => {
      switch (signal.type) {
        case 'connected':
          set({ connectionError: null })
          // A reconnect is a brand-new server socket sitting in `idle`, so an
          // active status has to be re-established or the screen lies.
          if (get().status === 'searching') get().startSearching()
          if (get().status === 'chatting') {
            clearTypingTimers()
            lastTypingSentAt = 0
            set({ status: 'ended', roomId: null, partnerTyping: false, endReason: 'disconnected' })
          }
          return

        case 'disconnected':
          set({ connectionError: 'Disconnected. Reconnecting…' })
          return

        case 'connect_error':
          if (signal.payload.code === ErrorCode.notAuthenticated) {
            get().signOut()
            set({ authError: 'Your session expired. Sign in again.' })
            return
          }
          set({ connectionError: signal.payload.message })
          return

        case 'presence:count':
          set({ online: signal.payload.online })
          return

        case 'queue:waiting':
          resetChat()
          set({ status: 'searching', roomId: null })
          return

        case 'match:found':
          clearTypingTimers()
          lastTypingSentAt = 0
          set({
            status: 'chatting',
            roomId: signal.payload.roomId,
            messages: [],
            partnerTyping: false,
            endReason: null,
            cooldownUntil: 0,
          })
          return

        case 'chat:message':
          appendMessage(signal.payload)
          return

        case 'chat:typing':
          setPartnerTyping(signal.payload.isTyping)
          return

        case 'chat:partner_left':
          clearTypingTimers()
          lastTypingSentAt = 0
          set({
            status: 'ended',
            roomId: null,
            partnerTyping: false,
            endReason: signal.payload.reason,
          })
          return

        case 'error':
          set({ lastError: signal.payload })
          return
      }
    },

    startSearching: () => {
      if (!emitToServer(ClientEvent.queueJoin)) return
      resetChat()
      set({ status: 'searching' })
    },

    cancelSearching: () => {
      if (!emitToServer(ClientEvent.queueLeave)) return
      resetChat()
      set({ status: 'idle' })
    },

    restart: () => {
      get().startSearching()
    },

    /**
     * `chat:skip` is "I am done, put me back in line": the server answers with
     * `queue:waiting`, so the client shows the searching screen straight away
     * rather than flashing the ended one.
     */
    skipPartner: () => {
      if (!emitToServer(ClientEvent.chatSkip)) return
      resetChat()
      set({ status: 'searching', roomId: null })
    },

    /**
     * `chat:leave` is "I am done": the server puts this user back to `idle` and
     * deliberately does not notify them, so the ended screen is entered here.
     */
    leaveChat: () => {
      if (!emitToServer(ClientEvent.chatLeave)) return
      resetChat()
      set({ status: 'ended', roomId: null, endReason: 'left' })
    },

    /**
     * Client-side mirrors of the two server-side rules that would otherwise only
     * surface as an error after the fact: trimmed length, and the sliding
     * send-rate window. Both exist to keep the UI honest, not to enforce — the
     * server still validates every message.
     */
    sendMessage: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return false
      if (trimmed.length > MAX_MESSAGE_LENGTH) return false

      const now = Date.now()

      recentSends = recentSends.filter((at) => at > now - RATE_LIMIT_WINDOW_MS)
      if (recentSends.length >= RATE_LIMIT_MESSAGES) return false
      if (!emitToServer(ClientEvent.chatMessage, { text: trimmed })) return false

      recentSends.push(now)

      const pending: ChatMessageView = {
        id: newLocalId(),
        text: trimmed,
        from: 'you',
        ts: now,
        pending: true,
      }

      set({
        messages: [...get().messages, pending],
        // The window only blocks once it is full: the next send is legal as soon
        // as one send leaves it, which is the send that would be the limit-th.
        cooldownUntil:
          recentSends.length < RATE_LIMIT_MESSAGES
            ? 0
            : (recentSends[recentSends.length - RATE_LIMIT_MESSAGES] ?? now) + RATE_LIMIT_WINDOW_MS,
      })

      lastTypingSentAt = 0
      emitToServer(ClientEvent.chatTyping, { isTyping: false })
      return true
    },

    /**
     * Throttled rather than debounced. A debounce would delay the indicator
     * until the typist paused, which is exactly when they are least likely to be
     * watched; a throttle sends the first keystroke immediately and then at most
     * one update per window.
     */
    setTyping: (isTyping) => {
      const now = Date.now()

      if (!isTyping) {
        lastTypingSentAt = 0
        emitToServer(ClientEvent.chatTyping, { isTyping: false })
        return
      }

      if (now - lastTypingSentAt < TYPING_THROTTLE_MS) return
      lastTypingSentAt = now
      emitToServer(ClientEvent.chatTyping, { isTyping: true })
    },

    dismissError: () => set({ lastError: null, connectionError: null }),
  }
})
