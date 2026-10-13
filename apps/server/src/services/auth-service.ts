import { OAuth2Client, type TokenPayload } from 'google-auth-library'
import type { Identity } from '@anonmatch/shared'

export type AuthErrorCode =
  | 'invalid_credential'
  | 'domain_not_allowed'
  /** Server and browser are using different OAuth clients, or the token is for another app. */
  | 'config_mismatch'
  /** The device clock is far enough off that Google rejects the token's iat/exp. */
  | 'clock_skew'

/**
 * Distinguishes "Google said no" from "your account is not on the list" so the
 * client can say something useful instead of a generic failure.
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode

  constructor(code: AuthErrorCode, message: string) {
    super(message)
    this.name = 'AuthError'
    this.code = code
  }
}

/**
 * Maps Google's failure reasons onto our codes.
 *
 * This exists because a bare `catch {}` turned every distinct root cause into
 * one useless "Google rejected this sign-in", which made a config mismatch
 * indistinguishable from an expired token. Only the *shape* of Google's message
 * is inspected, never the token itself.
 */
function classifyGoogleFailure(reason: string): AuthErrorCode {
  const lower = reason.toLowerCase()

  if (lower.includes('wrong recipient') || lower.includes('audience')) return 'config_mismatch'
  if (lower.includes('too late') || lower.includes('too early')) return 'clock_skew'
  return 'invalid_credential'
}

/**
 * What the user is told. Deliberately less specific than the server log:
 * `config_mismatch` is our bug, not theirs, so it gets a generic retry rather
 * than an explanation of OAuth internals. `clock_skew` is the exception because
 * the user can actually act on it.
 */
function clientMessage(code: AuthErrorCode): string {
  switch (code) {
    case 'config_mismatch':
      return 'Sign-in is temporarily unavailable. Please try again.'
    case 'clock_skew':
      return 'Your device date and time look wrong. Fix them and try again.'
    case 'domain_not_allowed':
      return 'That email address is not allowed to use Anonmatch.'
    case 'invalid_credential':
      return 'Google rejected this sign-in. Please try again.'
  }
}

export interface AuthServiceDeps {
  readonly googleClientId: string
  readonly isEmailAllowed: (email: string) => boolean
  /** Injected so tests can assert on diagnostics without stubbing console. */
  readonly logError?: (message: string, detail: Record<string, unknown>) => void
}

export class AuthService {
  readonly #client: OAuth2Client
  readonly #googleClientId: string
  readonly #isEmailAllowed: (email: string) => boolean
  readonly #logError: (message: string, detail: Record<string, unknown>) => void

  constructor(deps: AuthServiceDeps) {
    this.#googleClientId = deps.googleClientId
    this.#client = new OAuth2Client(deps.googleClientId)
    this.#isEmailAllowed = deps.isEmailAllowed
    this.#logError =
      deps.logError ??
      ((message, detail) => {
        console.error(message, detail)
      })
  }

  /**
   * Verifies a Google ID token and returns the identity behind it. This is a
   * real gate: the token is signature-checked against Google's public keys and
   * the audience must match our client ID. Unlike the legacy `/login`, there is
   * no path that mints a session from an unverified email string.
   */
  async authenticate(credential: string): Promise<Identity> {
    let payload: TokenPayload | undefined

    try {
      const ticket = await this.#client.verifyIdToken({
        idToken: credential,
        audience: this.#googleClientId,
      })
      payload = ticket.getPayload()
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      const code = classifyGoogleFailure(reason)

      // The reason is safe to log: it describes the failure, never the token.
      // Logging the audience alongside is what turns a config mismatch from a
      // twenty-minute investigation into a glance at two ids.
      this.#logError('Google rejected an ID token.', {
        code,
        reason,
        expectedAudience: this.#googleClientId,
        credentialLength: credential.length,
      })

      throw new AuthError(code, clientMessage(code))
    }

    const { sub, email, email_verified: emailVerified, name, picture } = payload ?? {}

    if (sub === undefined || email === undefined) {
      throw new AuthError('invalid_credential', 'That Google account is missing an email address.')
    }

    if (emailVerified !== true) {
      throw new AuthError(
        'invalid_credential',
        'That Google account does not have a verified email address.',
      )
    }

    if (!this.#isEmailAllowed(email)) {
      throw new AuthError('domain_not_allowed', clientMessage('domain_not_allowed'))
    }

    return {
      // Namespaced by provider so ids from different providers cannot collide
      // when a second provider is added.
      id: `google:${sub}`,
      email: email.toLowerCase(),
      name: name ?? email,
      picture: picture ?? null,
    }
  }
}
