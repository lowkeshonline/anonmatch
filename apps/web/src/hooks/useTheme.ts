import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'anonmatch.theme'

/**
 * Theme state lives on `<html data-theme>`, not in React, because the inline
 * script in `index.html` has to make the same decision before React mounts —
 * otherwise the first paint would flash the default theme. This hook only
 * mirrors and drives that attribute.
 */
function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : null
  } catch {
    return null
  }
}

function preferredTheme(): Theme {
  const stored = readStoredTheme()
  if (stored !== null) return stored
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(preferredTheme)

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

  // Each screen mounts its own copy of this hook, so a toggle in one would
  // otherwise leave the rest reading the theme they started with. The attribute
  // is the shared state, so everyone watches it instead of only their own write.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const next = document.documentElement.dataset['theme']
      if (next === 'light' || next === 'dark') setTheme(next)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  // Only follows the OS while the user has not made an explicit choice, so a
  // deliberate toggle is never undone by the system flipping at sunset.
  useEffect(() => {
    if (readStoredTheme() !== null) return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (event: MediaQueryListEvent) => setTheme(event.matches ? 'light' : 'dark')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // A failed write only costs the preference on the next visit.
      }
      return next
    })
  }, [])

  return { theme, toggle }
}
