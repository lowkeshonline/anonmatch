import { GoogleLogin } from '@react-oauth/google'
import { useAppStore } from '../../store/app-store'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

export function SignInScreen() {
  const signIn = useAppStore((state) => state.signIn)
  const isAuthenticating = useAppStore((state) => state.isAuthenticating)
  const authError = useAppStore((state) => state.authError)

  return (
    <section className="flex flex-col items-center gap-6 text-center">
      <header className="flex flex-col items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Chatwadi</h1>
        <p className="max-w-xs text-sm text-neutral-400">
          Talk to one stranger at a time. No profiles, no history.
        </p>
      </header>

      {CLIENT_ID === '' ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
          VITE_GOOGLE_CLIENT_ID is not set. Copy <code>apps/web/.env.example</code> to{' '}
          <code>apps/web/.env</code> and add your Google OAuth client ID.
        </p>
      ) : (
        <GoogleLogin
          onSuccess={(response) => {
            if (response.credential !== undefined) void signIn(response.credential)
          }}
          onError={() =>
            useAppStore.setState({ authError: 'Google sign-in was cancelled or failed.' })
          }
          useOneTap={false}
          width={280}
        />
      )}

      {isAuthenticating ? <p className="text-sm text-neutral-400">Verifying…</p> : null}
      {authError !== null ? (
        <p
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300"
        >
          {authError}
        </p>
      ) : null}
    </section>
  )
}
