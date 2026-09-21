let loaded = false

// Next loads .env files itself; drizzle-kit, tsx and vitest do not. Node's
// loader covers them without a dotenv dependency, and never overrides a
// variable that is already set, so Railway's values always win.
function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  for (const file of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(file)
    } catch {
      // Absent in production.
    }
  }
}

// Undefined rather than throwing: `next build` imports every route to collect
// page data, so a throw here would break builds run without secrets. A missing
// value surfaces on first query, which /api/health reports as 503.
export function databaseUrl(): string | undefined {
  ensureLoaded()
  return process.env.DATABASE_URL
}

export function requireDatabaseUrl(): string {
  const url = databaseUrl()
  if (!url) throw new Error('Missing DATABASE_URL. Copy .env.example to .env.local.')
  return url
}

export function requireAuthSecret(): string {
  ensureLoaded()
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('Missing AUTH_SECRET. Copy .env.example to .env.local.')
  return secret
}
