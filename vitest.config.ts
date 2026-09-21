import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    // Integration tests talk to a real database; give them room and do not let
    // separate files race each other into the same tables.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    include: ['tests/**/*.test.ts'],
  },
})
