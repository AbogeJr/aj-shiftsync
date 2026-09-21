import { defineConfig } from 'drizzle-kit'
import { requireDatabaseUrl } from './lib/env'

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: requireDatabaseUrl() },
  strict: true,
  verbose: true,
})
