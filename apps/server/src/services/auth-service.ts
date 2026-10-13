import { OAuth2Client, type TokenPayload } from 'google-auth-library'
import type { Identity } from '@chatwadi/shared'

export type AuthErrorCode = 'invalid_credential' | 'domain_not_allowed'

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

export interface AuthServiceDeps {
  readonly googleClientId: string
  readonly isEmailAllowed: (email: string) => boolean
}

export class AuthService {
  readonly #client: OAuth2Client
  readonly #googleClientId: string
  readonly #isEmailAllowed: (email: string) => boolean

  constructor(deps: AuthServiceDeps) {
    this.#googleClientId = deps.googleClientId
    this.#client = new OAuth2Client(deps.googleClientId)
    this.#isEmailAllowed = deps.isEmailAllowed
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
    } catch {
      throw new AuthError('invalid_credential', 'Google rejected this sign-in. Please try again.')
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
      throw new AuthError(
        'domain_not_allowed',
        'That email address is not allowed to use Chatwadi.',
      )
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
