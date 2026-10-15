import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAppStore, type ChatMessageView } from '../../store/app-store'

/** How close to the newest message still counts as "reading the bottom". */
const BOTTOM_THRESHOLD_PX = 56

/** The connect note. One per chat, shown above everything. */
function ConnectNote() {
  return (
    // `mt-auto` is what bottom-anchors a short conversation. `justify-end`
    // cannot: once the log overflows, its content starts past the scroll origin
    // and the earliest messages become unreachable.
    <p className="system-note animate-pop mt-auto">
      <span className="relative h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true">
        <span className="animate-spark absolute inset-0 rounded-full border-2 border-accent" />
      </span>
      <span>Connected. Neither of you can see who the other is.</span>
    </p>
  )
}

function TypingIndicator() {
  return (
    <div className="bubble-them animate-enter flex gap-[5px] py-[14px]">
      <span className="sr-only">Stranger is typing</span>
      {[0, 1, 2].map((index) => (
        <i
          key={index}
          aria-hidden="true"
          className="animate-blink h-[7px] w-[7px] rounded-full bg-muted not-italic"
          style={{ animationDelay: `${index * 0.2}s` }}
        />
      ))}
    </div>
  )
}

/**
 * Consecutive messages from the same side lose their corner so a burst reads as
 * one block instead of a stack of identical shapes. The radius rule is derived
 * from the design's `18px 18px 18px 6px` tail that points at the speaker.
 */
function MessageRow({
  message,
  grouped,
}: {
  readonly message: ChatMessageView
  readonly grouped: boolean
}) {
  const mine = message.from === 'you'
  const title = new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <p
      className={[
        mine ? 'bubble-me' : 'bubble-them',
        'animate-enter',
        message.pending === true ? 'opacity-60' : '',
      ].join(' ')}
      style={
        grouped
          ? {
              marginTop: '-4px',
              borderTopLeftRadius: mine ? undefined : '6px',
              borderTopRightRadius: mine ? '6px' : undefined,
            }
          : undefined
      }
      title={title}
    >
      <span className="sr-only">{mine ? 'You: ' : 'Stranger: '}</span>
      {message.text}
      {/* `title` is hover-only, so the stamp also needs a real node for
          keyboard, touch and screen readers. */}
      <time className="sr-only" dateTime={new Date(message.ts).toISOString()}>
        {title}
      </time>
    </p>
  )
}

/**
 * The transcript.
 *
 * `aria-live="polite"` rather than `assertive`: incoming messages should be
 * announced when the user is free to hear them, not in the middle of reading
 * one.
 *
 * Scrolling follows the reader, not the sender. The log only pins itself to the
 * newest message while the reader is already there — scrolled up, new messages
 * leave the scroll position alone and a pill offers the way back. Whether the
 * reader is at the bottom is mirrored into a ref as well as state, because the
 * effects below run before the render that would update the state.
 */
export function MessageList({ label }: { readonly label: string }) {
  const messages = useAppStore((state) => state.messages)
  const partnerTyping = useAppStore((state) => state.partnerTyping)
  const logRef = useRef<HTMLDivElement>(null)
  const stuckRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  const scrollToBottom = useCallback(() => {
    const node = logRef.current
    if (node === null) return
    node.scrollTop = node.scrollHeight
    stuckRef.current = true
    setAtBottom(true)
  }, [])

  // Layout effect so the jump lands in the same frame as the paint; with a
  // normal effect the newest message is briefly off-screen.
  useLayoutEffect(() => {
    if (stuckRef.current) scrollToBottom()
  }, [messages.length, partnerTyping, scrollToBottom])

  const onScroll = useCallback(() => {
    const node = logRef.current
    if (node === null) return
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight <= BOTTOM_THRESHOLD_PX
    // Only the threshold crossing is worth a render; every other scroll tick
    // would re-render the whole transcript for no visible change.
    if (stuckRef.current === nearBottom) return
    stuckRef.current = nearBottom
    setAtBottom(nearBottom)
  }, [])

  // The log itself resizes when the viewport does — the mobile keyboard opening
  // is the common case — which would otherwise leave the newest message above
  // the fold. Followed only while the reader is already at the bottom.
  useEffect(() => {
    const node = logRef.current
    if (node === null) return
    const observer = new ResizeObserver(() => {
      if (stuckRef.current) scrollToBottom()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [scrollToBottom])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label={`Conversation with a stranger: ${label}`}
        onScroll={onScroll}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-4 py-3 lg:gap-2.5 lg:px-6 lg:py-4"
      >
        <ConnectNote />
        {messages.map((message, index) => (
          <MessageRow
            key={message.id}
            message={message}
            grouped={messages[index - 1]?.from === message.from}
          />
        ))}
        {partnerTyping ? <TypingIndicator /> : null}
      </div>

      {atBottom ? null : (
        <button type="button" className="jump-latest" onClick={scrollToBottom}>
          Jump to latest
        </button>
      )}
    </div>
  )
}
