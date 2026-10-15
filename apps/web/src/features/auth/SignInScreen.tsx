import { useEffect, useRef, useState } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import { MoonIcon, SunIcon } from '../../components/Icons'
import { useTheme } from '../../hooks/useTheme'
import { useAppStore } from '../../store/app-store'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
/** Google's button sizes in pixels; narrow screens get the low end of its range. */
const GOOGLE_WIDTH_MIN = 180
const GOOGLE_WIDTH_MAX = 300

/**
 * Sign-in is not one of the four designed screens, so it borrows their language
 * rather than inventing one: same wordmark, same scale, same pill for
 * problems. The background is the app's one, mounted by the shell above it —
 * opaque surfaces here would cover it.
 */
export function SignInScreen() {
  const signIn = useAppStore((state) => state.signIn)
  const isAuthenticating = useAppStore((state) => state.isAuthenticating)
  const authError = useAppStore((state) => state.authError)
  const { theme, toggle } = useTheme()

  // The Google button is a fixed-width iframe, so a 320px viewport would clip
  // it rather than reflow it. Measuring the frame it sits in keeps it whole.
  const googleFrameRef = useRef<HTMLDivElement>(null)
  const [googleWidth, setGoogleWidth] = useState(GOOGLE_WIDTH_MAX)

  useEffect(() => {
    const node = googleFrameRef.current
    if (node === null) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return
      const width = Math.floor(entry.contentRect.width)
      if (width > 0) setGoogleWidth(Math.min(GOOGLE_WIDTH_MAX, Math.max(GOOGLE_WIDTH_MIN, width)))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="relative flex h-full animate-fade flex-col text-ink">
      <header className="flex shrink-0 items-center justify-end px-5 py-2 lg:px-10 lg:py-6">
        <button
          type="button"
          className="icon-btn"
          onClick={toggle}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
        </button>
      </header>

      <main className="screen-main items-center gap-6 px-5 text-center lg:px-7">
        <span className="text-2xl font-extrabold tracking-[-0.02em] lg:text-3xl">
          anonmatch
          <i className="ml-[4px] inline-block h-2.5 w-2.5 rounded-full bg-accent not-italic" />
        </span>

        <h1 className="display-heading text-[40px] lg:text-[64px]">Talk to someone new.</h1>
        <p className="sub-heading max-w-sm lg:text-xl">
          One stranger at a time. No profiles, no history, no screenshots.
        </p>

        <div
          ref={googleFrameRef}
          className="mt-2 flex h-12 w-full max-w-[300px] items-center justify-center"
        >
          {CLIENT_ID === '' ? (
            <p className="pill max-w-sm text-[13px] leading-snug text-muted">
              <code className="text-ink">VITE_GOOGLE_CLIENT_ID</code> is not set. Copy{' '}
              <code className="text-ink">apps/web/.env.example</code> to{' '}
              <code className="text-ink">apps/web/.env</code> and add your Google OAuth client ID.
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
              width={googleWidth}
            />
          )}
        </div>

        {isAuthenticating ? (
          <p role="status" className="text-sm text-muted">
            Verifying&hellip;
          </p>
        ) : null}

        {authError !== null ? (
          <p role="alert" className="pill max-w-sm text-[13px] leading-snug text-muted">
            {authError}
          </p>
        ) : null}
      </main>

      <p className="shrink-0 px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-4 text-center text-sm text-muted">
        Your Google account only proves you are human. It is never shown to anyone you match with.
      </p>
    </div>
  )
}
