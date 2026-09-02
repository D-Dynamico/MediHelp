/** @type {import('tailwindcss').Config} */

/**
 * The design system's tokens, and nothing else.
 *
 * Colours are declared here as `var(--…)` and defined in `index.css`, so a dark
 * theme is a swap of variables rather than a pass over every component. There is
 * deliberately no `darkMode` key: the app ships one theme, and leaving the class
 * strategy configured implied a promise it did not keep. The live queue board is
 * the one dark surface and carries its own fixed palette.
 *
 * Every value below is a decision from `docs/medihelp-design-system.md` §2. If a
 * component needs a colour, radius, shadow or size that is not here, the answer
 * is to add it here and say why — not to reach for a raw Tailwind class.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'var(--surface)',
          sunken: 'var(--surface-sunken)',
          raised: 'var(--surface-raised)',
        },
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },
        ink: {
          DEFAULT: 'var(--ink)',
          muted: 'var(--ink-muted)',
          faint: 'var(--ink-faint)',
        },
        brand: {
          50: 'var(--brand-50)',
          500: 'var(--brand-500)',
          600: 'var(--brand-600)',
          700: 'var(--brand-700)',
        },
        // Three stops each: a tint to sit on, text for that tint, and a fill.
        // Nothing in the product needs a fourth.
        success: {
          bg: 'var(--success-bg)',
          fg: 'var(--success-fg)',
          solid: 'var(--success-solid)',
        },
        warning: {
          bg: 'var(--warning-bg)',
          fg: 'var(--warning-fg)',
          solid: 'var(--warning-solid)',
        },
        danger: {
          bg: 'var(--danger-bg)',
          fg: 'var(--danger-fg)',
          solid: 'var(--danger-solid)',
        },
        info: {
          bg: 'var(--info-bg)',
          fg: 'var(--info-fg)',
          solid: 'var(--info-solid)',
        },
        // The wall display in the waiting room. Fixed, not themed: it is read
        // across a room off a bright TV, and it does not follow the app.
        board: {
          bg: '#0F172A',
          ink: '#F8FAFC',
          muted: '#94A3B8',
          accent: '#60A5FA',
        },
      },

      fontFamily: {
        sans: ['"IBM Plex Sans"', 'Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
      },

      // Seven steps, each with its line height fixed to it. A size without a
      // paired leading is how a type scale becomes decorative.
      fontSize: {
        display: ['2.5rem', { lineHeight: '2.75rem', letterSpacing: '-0.01em' }],
        h1: ['1.75rem', { lineHeight: '2.125rem' }],
        h2: ['1.25rem', { lineHeight: '1.75rem' }],
        h3: ['1rem', { lineHeight: '1.5rem' }],
        body: ['0.9375rem', { lineHeight: '1.5rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        xs: ['0.75rem', { lineHeight: '1rem' }],
      },

      // Three radii. Small things small, cards larger, circles round.
      borderRadius: {
        sm: '6px',
        md: '10px',
      },

      // Cards get none. Shadows are for things that float.
      boxShadow: {
        float: '0 4px 16px rgba(17, 24, 39, 0.08), 0 1px 2px rgba(17, 24, 39, 0.06)',
        modal: '0 16px 48px rgba(17, 24, 39, 0.16)',
      },

      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s linear infinite',
        'toast-in': 'toast-in 160ms ease-out',
        'fade-in': 'fade-in 120ms ease-out',
      },
    },
  },
  plugins: [],
};
