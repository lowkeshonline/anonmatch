import { useTheme } from '../../hooks/useTheme'
import { useAppStore } from '../../store/app-store'
// Vendored from the shadcn registry (@react-bits/Radar-JS-CSS); a WebGL2 scope
// with the sweep, afterglow and reduced-motion handling written into it.
import Radar from '../../components/Radar.jsx'

/**
 * Screen 2 — Searching.
 *
 * The radar reads as a live sweep rather than a loop: the phosphor afterglow
 * keeps the trail lit behind the sweep arm, and it goes still on its own under
 * `prefers-reduced-motion`. No contacts are spawned — nobody is found yet.
 * Colour comes from the locked accent token per theme so the scope never
 * introduces an off-palette hue.
 */
function Scope() {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <div
      className="h-[clamp(140px,30vh,220px)] w-[clamp(140px,30vh,220px)] lg:h-[clamp(160px,32vh,280px)] lg:w-[clamp(160px,32vh,280px)]"
      role="img"
      aria-label="Radar sweeping for an available stranger"
    >
      <Radar
        color={isDark ? '#896abd' : '#896abd'}
        lightMode={!isDark}
        mode="sweep"
        speed={1}
        trail={0.4}
        ringCount={4}
        spokeCount={8}
        ticks={false}
        targets={5}
        clutter={0.25}
        gridOpacity={0.7}
        grain={0.02}
        mouseInteraction={false}
      />
    </div>
  )
}

export function SearchingScreen() {
  const online = useAppStore((state) => state.online)
  const cancelSearching = useAppStore((state) => state.cancelSearching)

  return (
    <>
      <main className="screen-main items-center gap-10 text-center lg:gap-6">
        <Scope />
        <div role="status" aria-live="polite" className="animate-enter">
          <h2 className="status-heading lg:text-[44px] lg:tracking-[-0.035em]">
            Looking for someone&hellip;
          </h2>
          <p className="sub-heading mt-2 lg:mt-3 lg:text-xl lg:leading-[1.45]">
            Usually a few seconds. You&rsquo;re in line and will be matched as soon as
            someone&rsquo;s free.
          </p>
        </div>

        <button
          type="button"
          className="btn-secondary hidden lg:inline-flex lg:h-[52px] lg:w-[200px] lg:text-base"
          onClick={cancelSearching}
        >
          Cancel
        </button>
      </main>

      <div className="screen-footer lg:px-10 lg:pb-8 lg:pt-6">
        <button type="button" className="btn-secondary lg:hidden" onClick={cancelSearching}>
          Cancel
        </button>
        <p className="text-muted">{online.toLocaleString()} people online</p>
      </div>
    </>
  )
}