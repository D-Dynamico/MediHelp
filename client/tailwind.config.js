/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9ebff',
          500: '#2f6fed',
          600: '#1f57c9',
          700: '#1a459d',
        },
        ink: {
          DEFAULT: '#101827',
          muted: '#5b6472',
        },
        surface: {
          DEFAULT: '#ffffff',
          sunken: '#f6f8fb',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
