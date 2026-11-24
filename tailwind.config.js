/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./popup.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        danger: '#b00000',
        live: '#34d399',
        ink: '#0f172a',
        outline: '#cbd5e1',
        primary: '#1d4ed8',
        'primary-soft': '#e6edfd',
        success: '#047857',
        surface: '#f8fafc',
        variant: '#475569',
      },
      boxShadow: {
        soft: '0 2px 8px rgba(15,23,42,0.06)',
      },
    },
  },
  plugins: [],
};
