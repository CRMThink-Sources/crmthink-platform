import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Backoffice servido pela API em `/backoffice` (mesma origem de `/admin/*`: o cookie
 * de sessão vai sem CORS). Em dev, o Vite faz proxy de `/admin` para a API em :4100 —
 * rode a API com `BACKOFFICE_ORIGINS=http://localhost:5173` e `ADMIN_COOKIE_INSECURE=true`.
 */
export default defineConfig({
  base: '/backoffice/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: { '/admin': 'http://localhost:4100' },
  },
  build: {
    // Sem inline de assets em data: (a CSP só permite 'self').
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
