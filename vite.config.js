import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // xfwd: reenvía el host original, que el backend usa para validar el origen.
      '/api': { target: 'http://localhost:3001', xfwd: true },
      '/downloads': { target: 'http://localhost:3001', xfwd: true },
    },
  },
})
