import { useAppStore } from '../../store/app-store'

/**
 * M1 acceptance surface: proves the client reaches the server through the
 * Socket.IO handshake and that `presence:count` arrives live. The four product
 * screens replace this in M3.
 */
export function PresencePanel() {
  const user = useAppStore((state) => state.user)
  const online = useAppStore((state) => state.online)
  const connectionError = useAppStore((state) => state.connectionError)
  const signOut = useAppStore((state) => state.signOut)

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Connected</h1>
        {user !== null ? (
          <p className="text-sm text-neutral-400">
            Signed in as <span className="text-neutral-200">{user.email}</span>
          </p>
        ) : null}
      </header>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-5">
        <p className="text-sm text-neutral-400">Online now</p>
        <p aria-live="polite" className="mt-1 text-4xl font-semibold tabular-nums">
          {online}
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          Live count of signed-in users with an open socket.
        </p>
      </div>

      {connectionError !== null ? (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300"
        >
          {connectionError}
        </p>
      ) : (
        <p className="text-sm text-neutral-500">Socket connected.</p>
      )}

      <button
        type="button"
        onClick={signOut}
        className="rounded-md border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        Sign out
      </button>
    </section>
  )
}
