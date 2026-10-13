import { existsSync } from 'node:fs'
import { z } from 'zod'

/**
 * Node 20.12+ reads .env natively, so this needs no dotenv dependency.
 * Absent .env is fine in containers and CI where the environment is injected.
 */
function loadDotEnv(): void {
  if (existsSync('.env')) {
    process.loadEnvFile('.env')
  }
}

loadDotEnv()

const envSchema = z.strictObject({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  /**
   * Explicit allowlist. Deliberately not `*`: the legacy app sent
   * `allow_origins=["*"]` together with `allow_credentials=True`, which is an
   * invalid and unsafe pairing. We use a bearer token in a header rather than
   * cookies, so credentials are never needed and the wildcard buys nothing.
   */
  CORS_ORIGINS: z.string().min(1).default('http://localhost:5173'),
  GOOGLE_CLIENT_ID: z.string().min(1, {
    error:
      'GOOGLE_CLIENT_ID is required. Copy apps/server/.env.example to .env and set it to the client ID from your Google Cloud OAuth client.',
  }),
  /**
   * Comma-separated allowlist. `*` allows any verified Google account, an entry
   * containing `@` matches one exact address, a bare entry matches the email
   * domain exactly. Configurable here rather than hardcoded so adding more
   * institutions later is an env change, not a deploy.
   */
  ALLOWED_DOMAINS: z.string().default('*'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
})

/**
 * Only keys we own are parsed. `process.env` carries the whole shell
 * environment, so handing it straight to a strict schema fails on PATH, TERM
 * and friends. Filtering by our own prefixes first means a typo like
 * `GOOGLE_CLIENT_IDD` is still caught as an unrecognised key, while unrelated
 * ambient variables are ignored.
 */
const OWNED_PREFIXES = [
  'NODE_ENV',
  'HOST',
  'PORT',
  'CORS_ORIGINS',
  'GOOGLE_',
  'ALLOWED_',
  'SESSION_',
] as const

function pickOwnedEnv(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const picked: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(source)) {
    if (OWNED_PREFIXES.some((prefix) => key.startsWith(prefix))) picked[key] = value
  }
  return picked
}

const parsed = envSchema.safeParse(pickOwnedEnv(process.env))

if (!parsed.success) {
  const detail = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')
  console.error(`Invalid server environment:\n${detail}`)
  process.exit(1)
}

const env = parsed.data

/** One entry of the ALLOWED_DOMAINS allowlist. */
export type DomainRule =
  | { readonly kind: 'any' }
  | { readonly kind: 'domain'; readonly value: string }
  | { readonly kind: 'email'; readonly value: string }

function parseDomainRules(raw: string): readonly DomainRule[] {
  const rules: DomainRule[] = []

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim().toLowerCase()
    if (trimmed === '') continue
    if (trimmed === '*') return [{ kind: 'any' }]
    rules.push(
      trimmed.includes('@')
        ? { kind: 'email', value: trimmed }
        : { kind: 'domain', value: trimmed },
    )
  }

  return rules.length > 0 ? rules : [{ kind: 'any' }]
}

const domainRules = parseDomainRules(env.ALLOWED_DOMAINS)

/**
 * Exact domain match, not `endsWith`, so `evil-marwadiuniversity.ac.in` does
 * not satisfy a rule for `marwadiuniversity.ac.in`.
 */
export function isEmailAllowed(email: string): boolean {
  const normalised = email.trim().toLowerCase()
  const at = normalised.lastIndexOf('@')
  if (at === -1) return false
  const domain = normalised.slice(at + 1)

  return domainRules.some((rule) => {
    switch (rule.kind) {
      case 'any':
        return true
      case 'email':
        return normalised === rule.value
      case 'domain':
        return domain === rule.value
    }
  })
}

export const config = {
  env: env.NODE_ENV,
  host: env.HOST,
  port: env.PORT,
  corsOrigins: env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== ''),
  googleClientId: env.GOOGLE_CLIENT_ID,
  sessionTtlMs: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
} as const

export type Config = typeof config
