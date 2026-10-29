/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // Inter first, per the clinical/enterprise redesign spec - replaces
        // the earlier Plus Jakarta Sans-first "marketing site" pairing.
        sans: ['Inter', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Primary accent - professional blue, the single dominant accent
        // color across the app (was teal).
        primary: {
          DEFAULT: '#2563EB',
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        // Secondary - teal, now used sparingly (icons, small tags) rather
        // than as a gradient partner to primary.
        secondary: {
          DEFAULT: '#0F766E',
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0F766E',
          800: '#115e59',
          900: '#134e4a',
        },
        accent: {
          DEFAULT: '#3B82F6',
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3B82F6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        success: {
          DEFAULT: '#16A34A',
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#16A34A',
          600: '#15803d',
          700: '#166534',
          800: '#14532d',
          900: '#052e16',
        },
        warning: {
          DEFAULT: '#D97706',
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#F59E0B',
          600: '#D97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        danger: {
          DEFAULT: '#DC2626',
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#DC2626',
          600: '#b91c1c',
          700: '#991b1b',
          800: '#7f1d1d',
          900: '#450a0a',
        },
        background: {
          DEFAULT: '#F8FAFC',
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        healthcare: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        navy: {
          850: '#0f1729',
          900: '#0b1220',
          950: '#070d18',
        },
        // Clinical-SaaS dark surface system (exact palette spec):
        // DEFAULT = app shell/page background, secondary = sidebars/headers/
        // nested sections, panel = modals/panels, card = elevated cards.
        // Deliberately four distinct near-black shades, not one reused value.
        surface: {
          DEFAULT: '#0A0F1C',
          secondary: '#111827',
          panel: '#1A2233',
          card: '#182233',
          border: 'rgba(255,255,255,0.08)',
        },
      },
      boxShadow: {
        // Soft, single-layer, low-opacity, never colored - replaces the
        // earlier teal-tinted "glow" shadows entirely.
        glass: '0 1px 2px rgba(15, 23, 42, 0.06)',
        'glass-lg': '0 1px 3px rgba(15, 23, 42, 0.08)',
        'glass-teal': '0 1px 2px rgba(15, 23, 42, 0.08)',
        'glass-dark': '0 1px 2px rgba(0, 0, 0, 0.3)',
        card: '0 1px 2px rgba(15, 23, 42, 0.06)',
        'card-hover': '0 1px 3px rgba(15, 23, 42, 0.1)',
        'card-hover-dark': '0 1px 3px rgba(0, 0, 0, 0.4)',
        premium: '0 1px 3px rgba(15, 23, 42, 0.08)',
        'premium-dark': '0 1px 3px rgba(0, 0, 0, 0.4)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-glow': 'pulseGlow 2.5s ease-in-out infinite',
        'fade-in': 'fadeIn 0.2s ease-out forwards',
        'slide-up': 'slideUp 0.2s ease-out forwards',
        'slide-down': 'slideDown 0.2s ease-out forwards',
        'token-pop': 'tokenPop 0.2s ease-out forwards',
        shimmer: 'shimmer 1.8s ease-in-out infinite',
        'live-ping': 'livePing 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'scale-in': 'scaleIn 0.2s ease-out forwards',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          from: { opacity: '0', transform: 'translateY(-4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // No overshoot/bounce - a plain fade+scale-in, per the "no bounce/
        // elastic easing" rule.
        tokenPop: {
          from: { transform: 'scale(0.98)', opacity: '0' },
          to: { transform: 'scale(1)', opacity: '1' },
        },
        // Plain opacity pulse - the earlier version used a colored teal
        // glow box-shadow, which the new spec explicitly disallows.
        pulseGlow: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.85' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        livePing: {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '75%, 100%': { transform: 'scale(2.2)', opacity: '0' },
        },
        scaleIn: {
          from: { transform: 'scale(0.98)', opacity: '0' },
          to: { transform: 'scale(1)', opacity: '1' },
        },
      },
      transitionTimingFunction: {
        premium: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
};
