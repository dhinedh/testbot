import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/crm': 'http://localhost:3000',
      '/webhook': 'http://localhost:3000'
    }
  }
})
