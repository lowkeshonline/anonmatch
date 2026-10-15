import type { ChatPartnerLeftReason } from '@anonmatch/shared'
import { useAppStore } from '../../store/app-store'

/**
 * Screen 4 — Ended.
 *
 * The reason matters more than the headline: "they skipped" reads as a normal
 * part of the loop, "you skipped" and "you left" are exits, and "they
 * disconnected" is not anybody's fault. Same layout, different sentence.
 */
const REASON_COPY: Record<ChatPartnerLeftReason, string> = {
  skipped: 'The stranger skipped to someone new.',
  left: 'The stranger ended the chat.',
  disconnected: 'The stranger lost connection.',
}

export function EndedScreen() {
  const endReason = useAppStore((state) => state.endReason)
  const restart = useAppStore((state) => state.restart)

  return (
    <>
      <main className="screen-main items-center gap-7 text-center lg:gap-6">
        <div
          aria-hidden="true"
          className="animate-enter grid h-[88px] w-[88px] place-items-center rounded-full border-2 border-line lg:h-[112px] lg:w-[112px]"
        >
          <i className="h-3 w-3 rounded-full bg-accent opacity-70 not-italic lg:h-[14px] lg:w-[14px]" />
        </div>
        <div role="status" aria-live="polite" className="animate-enter">
          <h2 className="text-[32px] font-extrabold tracking-[-0.02em] lg:text-[56px]">
            Chat ended
          </h2>
          <p className="sub-heading mt-2 lg:mt-3 lg:text-xl lg:leading-[1.45]">
            {REASON_COPY[endReason ?? 'left']}
          </p>
        </div>

        <button
          type="button"
          className="btn hidden lg:inline-flex lg:h-[60px] lg:w-[280px]"
          onClick={restart}
        >
          Find a new stranger
        </button>
      </main>

      <div className="screen-footer lg:px-10 lg:pb-8 lg:pt-6">
        <button type="button" className="btn lg:hidden" onClick={restart}>
          Find a new stranger
        </button>
        <p className="text-muted">Nothing from this chat is saved.</p>
      </div>
    </>
  )
}
