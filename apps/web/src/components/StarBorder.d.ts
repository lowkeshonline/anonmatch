import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Types for the vendored star-border button, which ships as untyped `.jsx`.
 * Only the props this app sets are required; the rest fall back to the defaults
 * declared in the component signature.
 */
export interface StarBorderProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Element to render. Defaults to `button`, the only one wired here. */
  as?: 'button' | 'a'
  /** Built-in palette. The colour props below each override part of it. */
  theme?: 'dark' | 'light'
  /** Comet colour. */
  color?: string
  /** Comet trail colour; defaults to `color`. */
  trailColor?: string
  /** Seconds per lap. */
  duration?: number
  /** Rim line width in px. */
  thickness?: number
  radius?: number
  /** Comet trail length, 0–1. */
  trailLength?: number
  /** Stars riding the rim, 1–6. */
  stars?: number
  /** Comet glow, 0–1. */
  glow?: number
  sparkle?: boolean
  direction?: 'clockwise' | 'counterclockwise'
  /** Pointer behaviour: lap the rim, brighten, reveal a track, or nothing. */
  hover?: 'lap' | 'brighten' | 'reveal' | 'none'
  clickPulse?: boolean
  /** Button fill, over the theme surface. */
  backgroundColor?: string
  /** Label colour, over the theme text. */
  textColor?: string
  /** Rim track colour. */
  borderColor?: string
  children?: ReactNode
  className?: string
}

export default function StarBorder(props: StarBorderProps): JSX.Element
