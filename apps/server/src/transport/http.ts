import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ErrorCode, type CurrentUser } from '@anonmatch/shared'
import { type Config } from '../config.js'
import { AuthError, type AuthService } from '../services/auth-service.js'
import type { AuthSessionStore } from '../stores/auth-session-store.js'
import { corsMiddleware } from './cors.js'

const googleLoginSchema = z.strictObject({
  credential: z.string().min(1, { error: 'credential is required.' }),
})

/**
 * Google token verification is a network round trip to Google, so an
 * unthrottled endpoint lets anyone drive that cost. Fixed window rather than
 * sliding (unlike the message limiter in `ChatService`): the burst this stops
 * is a script, not a human double-sending.
 */
const AUTH_RATE_LIMIT = 10
const AUTH_RATE_WINDOW_MS = 60_000

export interface HttpDeps {
  readonly config: Config
  readonly authService: AuthService
  readonly authSessions: AuthSessionStore
}

/**
 * Security headers only. No CSP: this API serves JSON and the SPA is served by
 * Vercel, so a policy here could not be verified against anything.
 */
function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  next()
}

export function createHttpApp(deps: HttpDeps): Express {
  const { config, authService, authSessions } = deps
  const app = express()

  app.disable('x-powered-by')
  app.use(securityHeaders)
  app.use(corsMiddleware(config))
  app.use(express.json({ limit: '16kb' }))

  /** ip -> { count, resetsAt }. Swept on every request, so it stays bounded. */
  const authAttempts = new Map<string, { count: number; resetsAt: number }>()

  const rateLimitAuth = (req: Request, res: Response, next: NextFunction): void => {
    const nowMs = Date.now()
    for (const [ip, entry] of authAttempts) {
      if (entry.resetsAt <= nowMs) authAttempts.delete(ip)
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
    const entry = authAttempts.get(ip)
    if (entry === undefined) {
      authAttempts.set(ip, { count: 1, resetsAt: nowMs + AUTH_RATE_WINDOW_MS })
      next()
      return
    }
    if (entry.count >= AUTH_RATE_LIMIT) {
      res.setHeader('Retry-After', Math.ceil((entry.resetsAt - nowMs) / 1000))
      res.status(429).json({
        error: ErrorCode.rateLimited,
        message: `Too many sign-in attempts. Try again in ${Math.ceil((entry.resetsAt - nowMs) / 1000)} seconds.`,
      })
      return
    }
    entry.count += 1
    next()
  }

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) })
  })

  /**
   * Exchanges a Google ID token for an opaque session token. This is the only
   * REST call in the app; everything realtime goes over the socket.
   */
  app.post('/api/auth/google', rateLimitAuth, async (req: Request, res: Response) => {
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
