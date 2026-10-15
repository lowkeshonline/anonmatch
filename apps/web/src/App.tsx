import { useEffect } from 'react'
import { AmbientBackground } from './components/AmbientBackground'
import { AppHeader } from './components/AppHeader'
import { StatusToast } from './components/StatusToast'
import { SignInScreen } from './features/auth/SignInScreen'
import { ChatScreen } from './features/chat/ChatScreen'
import { EndedScreen } from './features/ended/EndedScreen'
import { LandingScreen } from './features/landing/LandingScreen'
import { SearchingScreen } from './features/searching/SearchingScreen'
import { useAppStore } from './store/app-store'

/**
 * One shell, four screens. `status` is the server-authoritative lifecycle from
 * the shared contract, so routing is a single exhaustive switch rather than a
 * pile of booleans that can disagree with each other.
 */
export function App() {
  const bootstrap = useAppStore((state) => state.bootstrap)
  const status = useAppStore((state) => state.status)
  const signOut = useAppStore((state) => state.signOut)

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  return (
    // `isolate` is what puts the background above this surface: without a
    // stacking context here, its `-z-10` layers would slide behind `bg-bg`.
    <div className="relative isolate flex h-full flex-col overflow-hidden bg-bg text-ink">
      {/* One instance for the whole session, above the screen switch: signing in
          or changing screen must not tear down the GPU context the shards are
          already drawing in. Searching is a full-bleed radar, so it is the only
          screen that keeps the plain surface. */}
      {status === 'searching' ? null : <AmbientBackground />}

      {status === 'unauthenticated' ? (
        <SignInScreen />
      ) : (
        <>
          <AppHeader
            // Mobile swaps the wordmark for the peer title while chatting; desktop
            // keeps both, the title repeating inside the panel header.
            mobileTitle={
              status === 'chatting'
                ? { title: 'Stranger', subtitle: 'Anonymous · text only' }
                : undefined
            }
            onSignOut={status === 'idle' ? signOut : undefined}
          />
          <StatusToast />

          {/* Keyed on `status`, so every screen change remounts this wrapper and
              replays the fade. Its flex classes are the shell's own, which keeps
              each screen's flex parent intact. */}
          <div key={status} className="flex min-h-0 flex-1 animate-fade flex-col">
            {status === 'idle' ? <LandingScreen /> : null}
            {status === 'searching' ? <SearchingScreen /> : null}
            {status === 'chatting' ? <ChatScreen /> : null}
            {status === 'ended' ? <EndedScreen /> : null}
          </div>
        </>
      )}
    </div>
  )
}
