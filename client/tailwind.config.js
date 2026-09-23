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
          100: 'var(--brand-100)',
          500: 'var(--brand-500)',
          600: 'var(--brand-600)',
          700: 'var(--brand-700)',
          800: 'var(--brand-800)',
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
          // Teal, to match the app, and 12:1 on the board's background.
          accent: '#5EEAD4',
        },
      },

      fontFamily: {
        // Humanist and round-shouldered, with real tabular figures for tokens,
        // fees and clocks. IBM Plex read engineered — right for a terminal,
        // cold for a waiting room.
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
      },

      // Eight steps, each with its line height fixed to it. A size without a
      // paired leading is how a type scale becomes decorative. `hero` exists for
      // exactly one place — the front page's opening line.
      fontSize: {
        hero: ['3.25rem', { lineHeight: '3.5rem', letterSpacing: '-0.025em' }],
        display: ['2.5rem', { lineHeight: '2.75rem', letterSpacing: '-0.02em' }],
        h1: ['1.75rem', { lineHeight: '2.125rem', letterSpacing: '-0.015em' }],
        h2: ['1.25rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em' }],
        h3: ['1rem', { lineHeight: '1.5rem' }],
        body: ['0.9375rem', { lineHeight: '1.5rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        xs: ['0.75rem', { lineHeight: '1rem' }],
      },

      // Four radii. Controls small, cards soft, large panels softer, and pills
      // and avatars round. The old 6/10 read as a spreadsheet's corners.
      borderRadius: {
        sm: '8px',
        md: '14px',
        lg: '20px',
      },

      // Depth in three steps. Cards now carry a whisper of shadow — a hairline
      // border alone made every page a grid of outlines — but only a whisper:
      // warm-tinted, low, and never enough to look like it floats.
      boxShadow: {
        card: '0 1px 2px rgba(28, 35, 33, 0.04), 0 2px 8px rgba(28, 35, 33, 0.04)',
        float: '0 8px 24px rgba(28, 35, 33, 0.10), 0 2px 4px rgba(28, 35, 33, 0.04)',
        modal: '0 24px 64px rgba(28, 35, 33, 0.20)',
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
