/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        brand: {
          50: '#eefcfb', 100: '#d4f7f4', 200: '#adeee9', 300: '#76e0da', 400: '#3cc9c3',
          500: '#1fadaa', 600: '#168a8a', 700: '#166e70', 800: '#17585a', 900: '#18494c', 950: '#082b2e',
        },
      },
      boxShadow: { card: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)' },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'slide-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'slide-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'pop-in': { from: { opacity: 0, transform: 'scale(.96) translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
      },
      animation: {
        'fade-in': 'fade-in .15s ease-out',
        'slide-in': 'slide-in .22s cubic-bezier(.2,.8,.2,1)',
        'pop-in': 'pop-in .18s ease-out',
        'slide-left': 'slide-left .22s cubic-bezier(.2,.8,.2,1)',
      },
    },
  },
  plugins: [],
}
