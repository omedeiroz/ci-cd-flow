import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60_000,
  },
})
