import type { CurrentUser } from '@chatwadi/shared'

const TOKEN_KEY = 'chatwadi.token'
const USER_KEY = 'chatwadi.user'

/**
 * Session persistence. Kept behind try/catch because Safari private mode and
 * some embedded webviews throw on `localStorage` access, and a storage failure
 * should cost the user a remembered session, not a blank page.
 */
export const sessionStorage = {
  readToken(): string | null {
    try {
      return window.localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },

  readUser(): CurrentUser | null {
    try {
      const raw = window.localStorage.getItem(USER_KEY)
      if (raw === null) return null
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return null
      const { id, email, name, picture } = parsed as Record<string, unknown>
      if (typeof id !== 'string' || typeof email !== 'string' || typeof name !== 'string') {
        return null
      }
      return { id, email, name, picture: typeof picture === 'string' ? picture : null }
    } catch {
      return null
    }
  },

  write(token: string, user: CurrentUser): void {
    try {
      window.localStorage.setItem(TOKEN_KEY, token)
      window.localStorage.setItem(USER_KEY, JSON.stringify(user))
    } catch {
      // Non-fatal: the session still works for this page load.
    }
  },

  clear(): void {
    try {
      window.localStorage.removeItem(TOKEN_KEY)
      window.localStorage.removeItem(USER_KEY)
    } catch {
      // Non-fatal.
    }
  },
}
