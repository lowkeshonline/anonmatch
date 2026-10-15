import type { HTMLAttributes } from 'react'

/**
 * Types for the vendored `@react-bits/Radar-JS-CSS` registry component, which
 * ships as untyped `.jsx`. Only the props this app sets are required; the rest
 * fall back to the defaults declared in the component signature.
 */
export interface RadarProps extends HTMLAttributes<HTMLDivElement> {
  /** Sweep colour, as a CSS colour string. */
  color?: string
  backgroundColor?: string
  mode?: 'sweep' | 'pulse'
  speed?: number
  /** Phosphor afterglow behind the sweep, 0.02–1. */
  trail?: number
  scale?: number
  /** Range rings, 1–24. */
  ringCount?: number
  /** Bearing spokes, 0–72. */
  spokeCount?: number
  ticks?: boolean
  /** Contacts on the scope, 0–16. Zero means nothing found yet. */
  targets?: number
  /** Ground clutter density, 0–1. */
  clutter?: number
  glow?: number
  brightness?: number
  gridOpacity?: number
  lineWidth?: number
  /** Camera tilt in degrees, 0–80. */
  tilt?: number
  centerX?: number
  centerY?: number
  /** Pointer heat spot; off under reduced motion regardless. */
  mouseInteraction?: boolean
  intro?: boolean
  grain?: number
  fade?: number
  opacity?: number
  /** Inverts the composite for light backgrounds. */
  lightMode?: boolean
  paused?: boolean
  /** Render scale. Capped at 2 internally; defaults to devicePixelRatio. */
  dpr?: number
  className?: string
}

export default function Radar(props: RadarProps): JSX.Element