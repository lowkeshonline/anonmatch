import type { NextFunction, Request, Response } from 'express'
import type { Config } from '../config.js'

/**
 * Explicit origin allowlist. The legacy app used
 * `allow_origins=["*"]` with `allow_credentials=True`, which is both invalid
 * and unnecessary here: we authenticate with a bearer token in a header, never
 * a cookie, so credentials mode is never enabled and the wildcard would only
 * widen who can call the API.
 */
export function corsMiddleware(config: Config) {
  const allowed = new Set(config.corsOrigins)

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin

    if (origin !== undefined && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    }
    // Caches must not serve one origin's response to another.
    res.setHeader('Vary', 'Origin')

    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }

    next()
  }
}
