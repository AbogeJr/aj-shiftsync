import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { databaseUrl } from '@/lib/env'
import * as schema from './schema'

/**
 * The connection pool. This deploys as one long-running Node service, so a real
 * pool is the right shape.
 *
 * pg.Pool does not open a socket on construction, and databaseUrl() does not
 * throw when the variable is missing, so importing this module is always safe -
 * including during `next build`, which imports every route to collect page
 * data. A missing or wrong URL surfaces on the first query instead, which
 * /api/health turns into a 503.
 */
type ShiftsyncDb = NodePgDatabase<typeof schema>

// Cached on globalThis so Next's dev-mode module reloading does not leak a new
// pool on every edit.
const globalForDb = globalThis as unknown as { __shiftsyncPool?: Pool }

function createPool(): Pool {
  const created = new Pool({
    connectionString: databaseUrl(),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

  // An idle client erroring (server restart, network blip) emits on the pool.
  // Without a handler this is an unhandled 'error' event and takes the process
  // down. pg discards the broken client on its own.
  created.on('error', (err) => {
    console.error('[db] idle client error', err)
  })

  return created
}

export const pool: Pool = (globalForDb.__shiftsyncPool ??= createPool())

export const db: ShiftsyncDb = drizzle(pool, { schema })

export type Db = ShiftsyncDb

/** The transaction handle drizzle passes to `db.transaction(...)` callbacks. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
