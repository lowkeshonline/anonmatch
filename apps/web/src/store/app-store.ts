import { create } from 'zustand'
import {
  ErrorCode,
  type CurrentUser,
  type ErrorPayload,
  type ServerSignal,
} from '@anonmatch/shared'
import { postJson } from '../lib/api'
import { connectSocket, disconnectSocket } from '../lib/socket'
import { sessionStorage } from '../lib/session-storage'

/**
 * Mirrors the server-authoritative lifecycle from the shared contract.
 * `unauthenticated` is the extra state that auth adds in front of `idle`;
 * without it the app cannot tell "show sign-in" from "show landing".
 */
export type AppStatus = 'unauthenticated' | 'idle' | 'searching' | 'chatting' | 'ended'

export interface AppStore {
  status: AppStatus
  user: CurrentUser | null
  roomId: string | null
  online: number
  isAuthenticating: boolean
  authError: string | null
  connectionError: string | null
  lastError: ErrorPayload | null

  bootstrap: () => void
  signIn: (credential: string) => Promise<void>
  signOut: () => void
  applyServerSignal: (signal: ServerSignal) => void
}

function isCurrentUser(value: unknown): value is CurrentUser {
  if (typeof value !== 'object' || value === null) return false
  const { id, email, name } = value as Record<string, unknown>
  return typeof id === 'string' && typeof email === 'string' && typeof name === 'string'
}

export const useAppStore = create<AppStore>((set, get) => ({
  status: 'unauthenticated',
  user: null,
  roomId: null,
  online: 0,
  isAuthenticating: false,
  authError: null,
  connectionError: null,
  lastError: null,

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
        set({ status: 'searching', roomId: null })
        return

      case 'match:found':
        set({ status: 'chatting', roomId: signal.payload.roomId })
        return

      case 'chat:message':
        // The message list itself is M3; the store only owns status here.
        return

      case 'chat:typing':
        return

      case 'chat:partner_left':
        set({ status: 'ended', roomId: null })
        return

      case 'error':
        set({ lastError: signal.payload })
        return
    }
  },
}))
