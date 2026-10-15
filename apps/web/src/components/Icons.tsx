/**
 * Icon set from the design: 2px stroke, round caps and joins, 24x24 grid. Kept
 * as inline components rather than an icon dependency because there are only
 * five of them and each is drawn once.
 */

interface IconProps {
  readonly size?: number
  readonly className?: string
}

const base = (size: number, className: string | undefined) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
  className,
})

export function MoonIcon({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}

export function SunIcon({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

export function SkipIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={2.2}>
      <path d="M5 4l10 8-10 8z" />
      <path d="M19 5v14" />
    </svg>
  )
}

export function SendIcon({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={2.4}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  )
}

export function SignOutIcon({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}
