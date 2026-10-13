/// <reference types="vite/client" />

/**
 * Declaring the env vars explicitly replaces Vite's index-signature
 * `ImportMetaEnv`, which `noPropertyAccessFromIndexSignature` rejects and which
 * silently types every var as `string | undefined` regardless of whether it
 * exists.
 */
interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string
  readonly VITE_SERVER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
