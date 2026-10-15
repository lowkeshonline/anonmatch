import { useAppStore } from '../../store/app-store'
import { Composer } from './Composer'
import { MessageList } from './MessageList'

const TITLE = 'Stranger'
const SUBTITLE = 'Anonymous · text only'

/**
 * Screen 3 — Chat.
 *
 * Two layouts from one component tree, because the design ships both: mobile is
 * a full-bleed column with the actions docked above the composer, desktop is a
 * 760px bordered panel with the same actions in the panel header. The
 * breakpoint matches the panel's own min width, so the switch happens where
 * the layout needs it rather than at an arbitrary tablet width.
 */
export function ChatScreen() {
  const skipPartner = useAppStore((state) => state.skipPartner)
  const leaveChat = useAppStore((state) => state.leaveChat)

  return (
    <>
      {/* Mobile: the log owns the space between header and composer. */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <MessageList label={`${TITLE} · ${SUBTITLE}`} />
        <Composer
          actions={
            <div className="flex gap-2">
              <button type="button" className="skip-btn flex-1" onClick={skipPartner}>
                Skip
              </button>
              <button type="button" className="leave-btn" onClick={leaveChat}>
                Leave
              </button>
            </div>
          }
        />
      </div>

      {/* Desktop: one bordered panel, actions in its header. */}
      <div className="hidden min-h-0 flex-1 justify-center px-10 pb-8 pt-0 lg:flex">
        <section
          aria-label="Chat with a stranger"
          className="glass flex h-full w-[760px] max-w-full flex-col overflow-hidden rounded-[20px] border border-line"
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div>
              <h1 className="text-lg font-bold">{TITLE}</h1>
              <p className="text-sm text-muted">{SUBTITLE}</p>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                className="skip-btn h-11 px-5 text-[15px]"
                onClick={skipPartner}
              >
                Skip
              </button>
              <button
                type="button"
                className="leave-btn h-11 px-[18px] text-[15px]"
                onClick={leaveChat}
              >
                Leave
              </button>
            </div>
          </div>

          <MessageList label={`${TITLE} · ${SUBTITLE}`} />
          <Composer hint />
        </section>
      </div>
    </>
  )
}
