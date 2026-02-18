/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./client/index.html",
    "./client/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Background
        'bg-primary': '#0A0A0F',
        'bg-surface': '#14141F',
        'bg-elevated': '#1E1E2E',
        // Accents
        'accent-cyan': '#00D9FF',
        'accent-green': '#00FF88',
        'accent-amber': '#FFB800',
        'accent-red': '#FF3B3B',
        'accent-violet': '#8B5CF6',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'breathe': 'breathe 3s ease-in-out infinite',
        'pulse-alert': 'pulse-alert 1s ease-in-out infinite',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': {
            opacity: '1',
            boxShadow: '0 0 20px currentColor',
          },
          '50%': {
            opacity: '0.8',
            boxShadow: '0 0 40px currentColor',
          },
        },
        'breathe': {
          '0%, 100%': {
            transform: 'scale(1)',
            opacity: '0.8',
          },
          '50%': {
            transform: 'scale(1.05)',
            opacity: '1',
          },
        },
        'pulse-alert': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
    },
  },
  plugins: [],
}
