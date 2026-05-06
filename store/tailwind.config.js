/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // IORA Design Tokens — adapt to both modes
        bg: 'var(--bg)',
        fg: 'var(--fg)',
        card: 'var(--card)',
        'card-hover': 'var(--card-hover)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        muted: 'var(--muted)',
        'muted-fg': 'var(--muted-fg)',
        border: 'var(--border-color)',
        success: 'var(--success)',
        destructive: 'var(--destructive)',
        star: '#f59e0b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '0.75rem',
        card: '1.25rem',
      },
      boxShadow: {
        card: '0 4px 24px var(--shadow-1), 0 1px 4px var(--shadow-2)',
        'card-hover': '0 8px 40px var(--shadow-1), 0 2px 8px var(--shadow-2)',
        'featured': '0 8px 32px var(--shadow-1)',
      },
      animation: {
        'shimmer': 'shimmer 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
      },
    },
  },
  plugins: [],
}
