import { MoonIcon, SignOutIcon, SunIcon } from './Icons'
import { useTheme } from '../hooks/useTheme'

interface AppHeaderProps {
  /**
   * Mobile only. The chat screen drops the wordmark for the peer title; desktop
   * keeps the wordmark in the page header and repeats the title in the panel.
   */
  readonly mobileTitle?: { readonly title: string; readonly subtitle: string }
  readonly onSignOut?: () => void
}

/** The wordmark: `anonmatch` plus a filled dot that doubles as the live mark. */
function Wordmark() {
  return (
    <span className="text-lg font-extrabold tracking-[-0.01em] lg:text-xl">
      anonmatch
      <i className="ml-[3px] inline-block h-2 w-2 rounded-full bg-accent not-italic" />
    </span>
  )
}

export function AppHeader({ mobileTitle, onSignOut }: AppHeaderProps) {
  const { theme, toggle } = useTheme()
  const nextTheme = theme === 'dark' ? 'light' : 'dark'

  return (
    // the notch/status bar can sit under the wordmark, so the safe-area insets
    // lift the header instead of each screen padding itself
    <header className="flex shrink-0 items-center justify-between px-[max(20px,env(safe-area-inset-left),env(safe-area-inset-right))] pb-2 pt-[max(8px,env(safe-area-inset-top))] lg:px-10 lg:py-6">
      <div className="min-w-0">
        {mobileTitle === undefined ? (
          <Wordmark />
        ) : (
          <>
            <div className="lg:hidden">
              <h1 className="text-[17px] font-bold">{mobileTitle.title}</h1>
              <p className="text-[13px] text-muted">{mobileTitle.subtitle}</p>
            </div>
            <div className="hidden lg:block">
              <Wordmark />
            </div>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center">
        {onSignOut === undefined ? null : (
          <button type="button" className="icon-btn" onClick={onSignOut} aria-label="Sign out">
            <SignOutIcon />
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          onClick={toggle}
          aria-label={`Switch to ${nextTheme} mode`}
        >
          {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
        </button>
      </div>
    </header>
  )
}
