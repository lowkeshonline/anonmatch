import express, { type Express, type Request, type Response } from 'express'
import { z } from 'zod'
import type { CurrentUser } from '@chatwadi/shared'
import { type Config } from '../config.js'
import { AuthError, type AuthService } from '../services/auth-service.js'
import type { AuthSessionStore } from '../stores/auth-session-store.js'
import { corsMiddleware } from './cors.js'

const googleLoginSchema = z.strictObject({
  credential: z.string().min(1, { error: 'credential is required.' }),
})

export interface HttpDeps {
  readonly config: Config
  readonly authService: AuthService
  readonly authSessions: AuthSessionStore
}

export function createHttpApp(deps: HttpDeps): Express {
  const { config, authService, authSessions } = deps
  const app = express()

  app.disable('x-powered-by')
  app.use(corsMiddleware(config))
  app.use(express.json({ limit: '16kb' }))

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) })
  })

  /**
   * Exchanges a Google ID token for an opaque session token. This is the only
   * REST call in the app; everything realtime goes over the socket.
   */
  app.post('/api/auth/google', async (req: Request, res: Response) => {
    const parsed = googleLoginSchema.safeParse(req.body)
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'INVALID_PAYLOAD', message: 'Expected { credential: string }.' })
      return
    }

    let identity
    try {
      identity = await authService.authenticate(parsed.data.credential)
    } catch (error) {
      if (error instanceof AuthError) {
        // A config mismatch is our fault, not the caller's, so it must not be
        // reported as a rejected credential.
        const status =
          error.code === 'domain_not_allowed' ? 403 : error.code === 'config_mismatch' ? 500 : 401
        res.status(status).json({ error: error.code, message: error.message })
        return
      }
      throw error
    }

    const session = authSessions.create(identity, Date.now())
    const user: CurrentUser = {
      id: identity.id,
      email: identity.email,
      name: identity.name,
      picture: identity.picture,
    }

    res.json({ token: session.token, user })
  })

  return app
}
