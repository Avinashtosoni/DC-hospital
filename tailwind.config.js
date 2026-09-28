/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Dashboard palette built on #CCCCFF · #A3A3CC · #5C5C99 · #292966
        brand: {
          50: '#f5f5ff', 100: '#ebebff', 200: '#dcdcfa', 300: '#ccccff', 400: '#a3a3cc',
          500: '#7a7ab3', 600: '#5c5c99', 700: '#484885', 800: '#363673', 900: '#292966', 950: '#1b1b47',
        },
        // Landing palette: #CCCCFF periwinkle → #A3A3CC → #5C5C99 → #292966 deep blue
        peri: {
          50: '#f7f7ff', 100: '#eeeeff', 200: '#e0e0ff', 300: '#ccccff', 400: '#a3a3cc',
          500: '#7d7db8', 600: '#5c5c99', 700: '#46467f', 800: '#292966', 900: '#1d1d4d', 950: '#121233',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(41,41,102,.04), 0 2px 8px -2px rgba(41,41,102,.07)',
        lift: '0 4px 10px -2px rgba(41,41,102,.08), 0 18px 40px -16px rgba(41,41,102,.22)',
        glass: '0 1px 0 rgba(255,255,255,.7) inset, 0 12px 40px -12px rgba(41,41,102,.25)',
        glow: '0 10px 40px -10px rgba(92,92,153,.55)',
        soft: '0 2px 4px rgba(41,41,102,.04), 0 12px 32px -8px rgba(41,41,102,.12)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'slide-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'slide-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'pop-in': { from: { opacity: 0, transform: 'scale(.96) translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        drift: { '0%,100%': { transform: 'translate(0,0) scale(1)' }, '33%': { transform: 'translate(30px,-40px) scale(1.08)' }, '66%': { transform: 'translate(-24px,20px) scale(.95)' } },
        marquee: { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
        'marquee-rev': { from: { transform: 'translateX(-50%)' }, to: { transform: 'translateX(0)' } },
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
        'pulse-ring': { '0%': { transform: 'scale(.8)', opacity: .7 }, '100%': { transform: 'scale(2.2)', opacity: 0 } },
        'draw': { from: { strokeDashoffset: 400 }, to: { strokeDashoffset: 0 } },
      },
      animation: {
        'fade-in': 'fade-in .15s ease-out',
        'slide-in': 'slide-in .22s cubic-bezier(.2,.8,.2,1)',
        'pop-in': 'pop-in .18s ease-out',
        'slide-left': 'slide-left .22s cubic-bezier(.2,.8,.2,1)',
        float: 'float 6s ease-in-out infinite',
        'float-slow': 'float 8s ease-in-out infinite',
        drift: 'drift 18s ease-in-out infinite',
        'drift-slow': 'drift 26s ease-in-out infinite reverse',
        marquee: 'marquee 40s linear infinite',
        'marquee-rev': 'marquee-rev 45s linear infinite',
        shimmer: 'shimmer 6s linear infinite',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(.2,.6,.4,1) infinite',
        draw: 'draw 2.4s ease-out infinite',
      },
    },
  },
  plugins: [],
}
