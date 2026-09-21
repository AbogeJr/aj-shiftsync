/**
 * Environment access.
 *
 * Next.js loads .env files itself, but the standalone entry points (drizzle-kit,
 * tsx scripts, vitest) do not. Node's built-in loader covers those without
 * pulling in a dotenv dependency. It does not overwrite variables that are
 * already present, so real environment values (Railway) always win over files.
 */
let loaded = false

function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  for (const file of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(file)
    } catch {
      // File absent or unreadable - expected in production.
    }
  }
}

/**
 * The database connection, used by everything.
 *
 * Returns undefined rather than throwing so that importing the db module never
 * fails at build time - `next build` imports every route to collect page data,
 * and a throw here would break builds run without secrets. A missing value
 * surfaces as a connection error on first query, which /api/health reports
 * as 503.
 */
export function databaseUrl(): string | undefined {
  ensureLoaded()
  return process.env.DATABASE_URL
}

/** Throwing variant, for tooling that cannot proceed without it. */
export function requireDatabaseUrl(): string {
  const url = databaseUrl()
  if (!url) {
    throw new Error(
      'Missing required environment variable DATABASE_URL. Copy .env.example to .env.local and fill it in.',
    )
  }
  return url
}

/**
 * Secret for signing session cookies. Any sufficiently long random string.
 * Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
 */
export function requireAuthSecret(): string {
  ensureLoaded()
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error(
      'Missing required environment variable AUTH_SECRET. Copy .env.example to .env.local and fill it in.',
    )
  }
  return secret
}
