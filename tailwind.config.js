/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./popup.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        danger: '#b00000',
        ink: '#191c1e',
        outline: '#c3c6d7',
        primary: '#004ac6',
        'primary-soft': '#dbe8ff',
        success: '#006329',
        surface: '#f7f9fb',
        variant: '#434655',
      },
      boxShadow: {
        soft: '0 2px 8px rgba(15,23,42,0.06)',
      },
    },
  },
  plugins: [],
};
