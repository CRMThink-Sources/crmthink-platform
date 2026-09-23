import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    // Mais específico primeiro: o Vite casa alias por prefixo, na ordem.
    alias: {
      '@/prisma': path.resolve(__dirname, './prisma/generated/prisma'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'sdk/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./src/test/setup-env.ts'],
  },
})
