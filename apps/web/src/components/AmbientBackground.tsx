import { useState } from 'react'
import AeroShards from './AeroShards'
import { useTheme } from '../hooks/useTheme'

/**
 * The background on every screen except searching, which is a full-bleed radar
 * and keeps the plain surface.
 *
 * Decorative, so it is hidden from assistive tech. WebGPU is the only hard
 * requirement and not every browser has it, so a device that cannot draw falls
 * back to the photograph the app used before — better a plain surface than an
 * exception.
 */
export function AmbientBackground() {
  const { theme } = useTheme()
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div className="bg-ambient-shift" aria-hidden="true">
        <div className="bg-ambient" />
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
      <AeroShards
        shardColor="#896ABD"
        accentColor="#A855F7"
        placement="full"
        material="glass"
        markers="plus"
        count={1300}
        depthOfField={0.47}
        vignette={0.07}
        mouseInteraction
        pulseOnClick
        holdToGather
        lightMode={theme === 'light'}
        shardSize={1}
        spread={1.26}
        twist={1}
        billow={0.42}
        speed={0.66}
        scale={1}
        glow={0.25}
        grain={0.06}
        intro
        mouseStrength={0.51}
        parallax={0.5}
        paused={false}
        onError={() => setFailed(true)}
      />
    </div>
  )
}
