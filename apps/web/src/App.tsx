import { useEffect } from 'react'
import { SignInScreen } from './features/auth/SignInScreen'
import { PresencePanel } from './features/presence/PresencePanel'
import { useAppStore } from './store/app-store'

export function App() {
  const bootstrap = useAppStore((state) => state.bootstrap)
  const status = useAppStore((state) => state.status)

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-6 py-12">
      {status === 'unauthenticated' ? <SignInScreen /> : <PresencePanel />}
    </main>
  )
}
