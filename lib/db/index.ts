import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { databaseUrl } from '@/lib/env'
import * as schema from './schema'

// Cached on globalThis so Next's dev-mode reloading does not leak a pool per edit.
const globalForDb = globalThis as unknown as { __shiftsyncPool?: Pool }

function createPool(): Pool {
  const created = new Pool({
    connectionString: databaseUrl(),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

  // Without a handler, an erroring idle client is an unhandled 'error' event
  // and takes the process down.
  created.on('error', (err) => console.error('[db] idle client error', err))

  return created
}

export const pool: Pool = (globalForDb.__shiftsyncPool ??= createPool())

export const db = drizzle(pool, { schema })

export type Db = NodePgDatabase<typeof schema>
