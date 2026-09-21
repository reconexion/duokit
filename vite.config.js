import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
// BACKEND_URL solo se usa para probar contra otro backend; normalmente es el de siempre.
const backend = process.env.BACKEND_URL || 'http://localhost:3001'

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
      '/api': { target: backend, xfwd: true },
      '/downloads': { target: backend, xfwd: true },
    },
  },
})
