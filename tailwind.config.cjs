// tailwind.config.cjs
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,html}",
  ],
  theme: {
    extend: {
      // Custom responsive breakpoints for side panel widths
      screens: {
        'xs': '400px',
        'sm': '500px',
        'md': '700px',
      },
      // ADR 003: GitHub Dark palette design tokens
      colors: {
        fm: {
          bg: '#0D1117',
          surface: '#161B22',
          elevated: '#21262D',
          border: '#30363D',
          'border-light': '#21262D',
          active: '#58A6FF',
          text: '#E6EDF3',
          dim: '#8B949E',
          muted: '#6E7681',
          blue: '#58A6FF',
          'blue-light': 'rgba(88, 166, 255, 0.15)',
          'blue-border': 'rgba(88, 166, 255, 0.3)',
          green: '#3FB950',
          'green-light': 'rgba(63, 185, 80, 0.15)',
          'green-border': 'rgba(63, 185, 80, 0.3)',
          yellow: '#D29922',
          'yellow-light': 'rgba(210, 153, 34, 0.15)',
          'yellow-border': 'rgba(210, 153, 34, 0.3)',
          red: '#F85149',
          'red-light': 'rgba(248, 81, 73, 0.15)',
          purple: '#A371F7',
          'purple-light': 'rgba(163, 113, 247, 0.15)',
          'purple-border': 'rgba(163, 113, 247, 0.3)',
        },
      },
      fontFamily: {
        sans: ["DM Sans", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      animation: {
        'slide-in-from-top': 'slideInFromTop 0.2s ease-out',
        'pulse-dot': 'pulseDot 1.4s ease-in-out infinite',
        'spin': 'spin 1s linear infinite',
      },
      keyframes: {
        slideInFromTop: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '0.2', transform: 'scale(0.8)' },
          '50%': { opacity: '1', transform: 'scale(1.15)' },
        },
      },
      borderRadius: {
        'user-msg': '8px 8px 0px 8px',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
