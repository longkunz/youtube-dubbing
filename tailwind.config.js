/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'cyber-cyan': '#00f2fe',
        'cyber-purple': '#7928ca',
        'hyper-magenta': '#ff007a',
        'matrix-emerald': '#00ff88',
        'solar-amber': '#ffb703',
        'void-dark': '#05070e',
      },
      fontFamily: {
        orbitron: ['Orbitron', 'monospace'],
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Inter', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        'glow-cyan': '0 0 24px rgba(0, 242, 254, 0.3)',
        'glow-magenta': '0 0 24px rgba(255, 0, 122, 0.3)',
        'glow-emerald': '0 0 20px rgba(0, 255, 136, 0.4)',
      },
    },
  },
  plugins: [],
};
