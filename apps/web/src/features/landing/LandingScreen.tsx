// Vendored from the shadcn registry (star-border): a 2D comet that laps the rim.
// It owns its own dark/light palettes, so `theme` is the only thing the caller
// has to pass, and its unlayered CSS means size and weight need `!important`.
import StarBorder from '../../components/StarBorder.jsx'
import { useTheme } from '../../hooks/useTheme'
import { useAppStore } from '../../store/app-store'

/**
 * Screen 1 — Landing.
 *
 * The signed-in resting state: live presence, one promise, one action. The
 * presence number is real, not a mock, so the count moves under the copy and
 * the "people online" claim stays honest.
 */
export function LandingScreen() {
  const online = useAppStore((state) => state.online)
  const startSearching = useAppStore((state) => state.startSearching)
  const { theme } = useTheme()

  // The comet settings, shared by both Start buttons. The pill is translucent so
  // the shards behind it stay visible, and spends its contrast on the rim
  // instead: a brighter track and a thicker, brighter comet, which is what makes
  // the outline read against a dark screen.
  const isDark = theme === 'dark'
  const comet = {
    theme,
    backgroundColor: isDark ? 'rgba(26,26,31,0.72)' : 'rgba(235,235,237,0.75)',
    textColor: isDark ? '#fafafa' : '#18181b',
    borderColor: isDark ? 'rgba(250,250,250,0.28)' : 'rgba(24,24,27,0.22)',
    color: isDark ? '#fafafa' : '#18181b',
    trailColor: isDark ? '#fafafa' : '#18181b',
    duration: 6,
    direction: 'clockwise',
    stars: 1,
    trailLength: 0.3,
    thickness: 1.5,
    radius: 12,
    glow: 0.9,
    hover: 'lap',
    sparkle: true,
    clickPulse: true,
  } as const

  return (
    <>
      <main className="screen-main gap-4 lg:items-center lg:gap-6 lg:text-center">
        <p className="pill self-start lg:self-center">
          <span className="live-dot" aria-hidden="true" />
          <span>
            <b className="font-bold text-ink">{online.toLocaleString()}</b> people online now
          </span>
        </p>
        <h1 className="display-heading lg:text-[76px] lg:leading-none lg:tracking-[-0.035em]">
          Talk to someone new.
        </h1>
        <p className="sub-heading lg:max-w-[520px] lg:text-xl lg:leading-[1.45]">
          Anonymous, text only, and gone the moment you&rsquo;re done.
        </p>

        {/* Desktop centres the action with the headline; mobile pins it to the
            footer above the legal line, so it never competes with the promise.
            The blur lives on the wrapper: the comet sets its own stacking
            context, and an element inside one has nothing to sample. */}
        <div className="hidden justify-center lg:mt-6 lg:flex">
          <div className="rounded-[13px] backdrop-blur-xl">
            <StarBorder {...comet} className="w-[280px] !py-[18px] !text-lg !font-bold" onClick={startSearching}>
              Start
            </StarBorder>
          </div>
        </div>
      </main>

      <div className="screen-footer lg:px-10 lg:pb-8 lg:pt-6">
        <div className="rounded-[13px] backdrop-blur-xl lg:hidden">
          <StarBorder {...comet} className="w-full !py-[15px] !text-lg !font-bold" onClick={startSearching}>
            Start
          </StarBorder>
        </div>
        <p className="text-muted">Signed in with Google. Nobody sees who you are.</p>
      </div>
    </>
  )
}
