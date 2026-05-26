/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'wa-green': '#25D366',
        'wa-dark-green': '#128C7E',
        'wa-teal': '#075E54',
        'bg-light': '#f0f2f5',
        'bg-white': '#ffffff',
        'text-dark': '#111b21',
        'text-muted': '#667781',
        'border-color': '#d1d7db',
        'bubble-sent': '#d9fdd3',
        'bubble-received': '#ffffff',
        'danger': '#ef4444',
      }
    },
  },
  plugins: [],
}
