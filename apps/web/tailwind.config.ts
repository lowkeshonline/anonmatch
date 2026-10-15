import type { Config } from 'tailwindcss'

/**
 * Theme tokens live as space-separated RGB channels in `index.css` so Tailwind
 * opacity modifiers keep working (`bg-accent/10`). The values are the locked
 * design tokens: monochrome black surface by default, inverted for light.
 */
const token = (name: string) => `rgb(var(${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Figtree', 'system-ui', 'sans-serif'],
      },
      colors: {
        bg: token('--c-bg'),
        surface: token('--c-surface'),
        line: token('--c-line'),
        ink: token('--c-ink'),
        muted: token('--c-muted'),
        accent: token('--c-accent'),
        'on-accent': token('--c-on-accent'),
      },
      keyframes: {
        ring: {
          '0%': { transform: 'scale(0.4)', opacity: '0.6' },
          '100%': { transform: 'scale(1.5)', opacity: '0' },
        },
        blink: {
          '0%,80%,100%': { opacity: '0.25' },
          '40%': { opacity: '1' },
        },
        'dot-pulse': {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        enter: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
        pop: {
          '0%': { transform: 'scale(0.85)', opacity: '0' },
          '60%': { transform: 'scale(1.04)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        spark: {
          '0%': { transform: 'scale(0.4)', opacity: '0.7' },
          '100%': { transform: 'scale(2.4)', opacity: '0' },
        },
      },
      animation: {
        ring: 'ring 3.2s ease-out infinite',
        blink: 'blink 1.2s ease-in-out infinite',
        dot: 'dot-pulse 2s ease-in-out infinite',
        enter: 'enter 0.25s ease-out both',
        fade: 'fade 0.25s ease-out both',
        pop: 'pop 0.4s ease-out both',
        spark: 'spark 0.9s ease-out 1 both',
      },
    },
  },
  plugins: [],
} satisfies Config
