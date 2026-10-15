import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { MAX_MESSAGE_LENGTH } from '@anonmatch/shared'
import { useAppStore } from '../../store/app-store'
import { SendIcon } from '../../components/Icons'

/** Characters left before the counter replaces the keyboard hint. */
const COUNTER_THRESHOLD = 100
/** How often the send-cooldown countdown re-renders. */
const TICK_MS = 250

/** Physical keyboards get Enter-to-send; touch keyboards must not lose a newline. */
function hasPhysicalKeyboard(): boolean {
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

interface ComposerProps {
  /** Mobile-only action row above the input. Desktop puts these in the header. */
  readonly actions?: ReactNode
  /** Desktop-only status line under the input. */
  readonly hint?: boolean
}

export function Composer({ actions, hint = false }: ComposerProps) {
  const sendMessage = useAppStore((state) => state.sendMessage)
  const setTyping = useAppStore((state) => state.setTyping)
  const cooldownUntil = useAppStore((state) => state.cooldownUntil)

  const [draft, setDraft] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const cooldownMs = Math.max(0, cooldownUntil - now)
  const coolingDown = cooldownMs > 0
  const trimmedLength = draft.trim().length
  const canSend = trimmedLength > 0 && !coolingDown && trimmedLength <= MAX_MESSAGE_LENGTH

  useEffect(() => {
    if (!coolingDown) return
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [coolingDown])

  // Leaving the screen with "typing" still latched would strand the partner's
  // indicator until their staleness timer fires.
  useEffect(() => () => setTyping(false), [setTyping])

  const submit = useCallback(() => {
    if (!canSend) return
    // A refused send (socket down, rate limited) keeps the draft so nothing typed is lost.
    if (!sendMessage(draft)) return
    setDraft('')
    setTyping(false)
    inputRef.current?.focus()
  }, [canSend, draft, sendMessage, setTyping])

  const onChange = useCallback(
    (next: string) => {
      setDraft(next)
      setTyping(next.trim() !== '')
    },
    [setTyping],
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Enter' || event.shiftKey || !hasPhysicalKeyboard()) return
      event.preventDefault()
      submit()
    },
    [submit],
  )

  const charactersLeft = MAX_MESSAGE_LENGTH - trimmedLength
  const hintText = coolingDown
    ? `Slow down — ${Math.ceil(cooldownMs / 1000)}s`
    : charactersLeft <= COUNTER_THRESHOLD
      ? `${charactersLeft} characters left`
      : 'Enter to send · Shift+Enter for a new line'

  return (
    <div className="border-t border-line px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 lg:px-5 lg:pb-4 lg:pt-3.5">
      {actions}

      <div className={actions === undefined ? '' : 'mt-2 lg:mt-0'}>
        <div className="flex items-end gap-2">
          <label className="sr-only" htmlFor="composer">
            Message
          </label>
          <textarea
            id="composer"
            ref={inputRef}
            className="composer-input"
            rows={1}
            value={draft}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Say something…"
            aria-describedby={hint ? 'composer-hint' : undefined}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => setTyping(false)}
          />

          {/* Mobile: icon-only square, exactly the 48px control the design docks. */}
          <button
            type="button"
            className="send-btn grid h-12 w-12 lg:hidden"
            onClick={submit}
            aria-disabled={!canSend}
            aria-label={
              coolingDown
                ? `Send message, slow down ${Math.ceil(cooldownMs / 1000)} seconds`
                : 'Send message'
            }
          >
            <SendIcon />
          </button>

          {/* Desktop: labelled, because there is room for the affordance. */}
          <button
            type="button"
            className="send-btn hidden h-[52px] items-center gap-2 px-5 text-[15px] font-bold lg:inline-flex"
            onClick={submit}
            aria-disabled={!canSend}
          >
            Send
            <SendIcon size={18} />
          </button>
        </div>

        {hint ? (
          <p id="composer-hint" className="mt-2.5 text-xs text-muted" aria-live="polite">
            {hintText}
          </p>
        ) : null}
      </div>
    </div>
  )
}
