/**
 * In dev, Vite proxies `/api` and `/socket.io` to the server so the browser
 * sees a single origin. In production the static host must do the same, so the
 * default is a relative path. `VITE_SERVER_URL` overrides it when the API
 * genuinely lives on another host.
 */
const API_BASE = import.meta.env.VITE_SERVER_URL ?? ''

export type ApiError = { readonly error: string; readonly message: string }

export type ApiResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ApiError }

export async function postJson(path: string, body: unknown): Promise<ApiResult<unknown>> {
  let response: Response

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, error: { error: 'NETWORK', message: 'Could not reach the server.' } }
  }

  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    return {
      ok: false,
      error: { error: 'INVALID_RESPONSE', message: 'The server sent a malformed response.' },
    }
  }

  if (!response.ok) {
    const record: unknown = parsed
    const message =
      typeof record === 'object' &&
      record !== null &&
      'message' in record &&
      typeof record.message === 'string'
        ? record.message
        : 'Something went wrong.'
    const code =
      typeof record === 'object' &&
      record !== null &&
      'error' in record &&
      typeof record.error === 'string'
        ? record.error
        : 'UNKNOWN'
    return { ok: false, error: { error: code, message } }
  }

  return { ok: true, data: parsed }
}
