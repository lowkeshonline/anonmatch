import type { CSSProperties } from 'react'

/**
 * Types for the vendored `@react-bits/AeroShards-JS-CSS` registry component,
 * which ships as untyped `.jsx` and draws with WebGPU (`vgpu`). Anything omitted
 * falls back to the defaults declared in the component signature.
 */
export interface AeroShardsProps {
  /** Body colour of the shards, as a CSS colour string. */
  shardColor?: string
  accentColor?: string
  /** Opaque backdrop, or `transparent` to composite over the page. */
  backgroundColor?: string
  /** Lighter studio lighting, for a light-themed page. */
  lightMode?: boolean
  /** Where the ribbons sit: across the frame, or to one side, or ringed. */
  placement?: 'full' | 'left' | 'right' | 'center'
  material?: 'glass' | 'chrome'
  /** Shard count, 100–6000. */
  count?: number
  shardSize?: number
  spread?: number
  twist?: number
  billow?: number
  speed?: number
  scale?: number
  /** Far-shard blur, 0–1. */
  depthOfField?: number
  glow?: number
  grain?: number
  vignette?: number
  /** Arrival animation; skipped under reduced motion. */
  intro?: boolean
  mouseInteraction?: boolean
  mouseStrength?: number
  /** Floating cross-hairs, or off for none. */
  markers?: 'plus' | 'dots'
  pulseOnClick?: boolean
  holdToGather?: boolean
  parallax?: number
  paused?: boolean
  /** Render scale, capped at 2 by devicePixelRatio. */
  dpr?: number
  className?: string
  style?: CSSProperties
  /** Called when WebGPU is missing or the device is lost. */
  onError?: (error: Error) => void
}

export default function AeroShards(props: AeroShardsProps): JSX.Element
