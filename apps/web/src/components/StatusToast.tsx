import { useEffect } from 'react'
import { useAppStore } from '../store/app-store'

/**
 * One inline strip for the two things the user must not miss: a broken
 * connection and the latest server error. It sits under the header rather than
 * floating over the composer, because on mobile anything overlapping the dock
 * covers the send button at exactly the moment it is needed.
 *
 * Server errors clear themselves after a few seconds; a lost connection does
 * not, because the socket layer owns that state and will replace the message
 * when it reconnects.
 */
const SERVER_ERROR_TTL_MS = 5_000

export function StatusToast() {
  const connectionError = useAppStore((state) => state.connectionError)
  const lastError = useAppStore((state) => state.lastError)
  const dismissError = useAppStore((state) => state.dismissError)

  const message = connectionError ?? lastError?.message ?? null
  const isAlert = connectionError === null && lastError !== null

  useEffect(() => {
    if (lastError === null) return
    const timer = setTimeout(dismissError, SERVER_ERROR_TTL_MS)
    return () => clearTimeout(timer)
  }, [lastError, dismissError])

  if (message === null) return null

  return (
    <div className="shrink-0 px-5 lg:px-10">
      <p
        role={isAlert ? 'alert' : 'status'}
        aria-live={isAlert ? 'assertive' : 'polite'}
        // `flex` overrides the pill's inline-flex: an inline-level box ignores
        // `mx-auto`, which is why the toast used to sit in the top-left corner.
        className="animate-fade pill mx-auto flex max-w-xl text-[13px] text-muted"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-left">{message}</span>
        <button
          type="button"
          onClick={dismissError}
          className="-mr-1 shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Dismiss
        </button>
      </p>
    </div>
  )
}
