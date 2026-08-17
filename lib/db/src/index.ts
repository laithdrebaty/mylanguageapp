import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * Connection pool configuration.
 *
 * Defaults are chosen for a single-server deployment with ~10–100 concurrent
 * users. Each PostgreSQL connection uses ~5–10 MB of server RAM, so keep the
 * pool small enough to avoid exhausting the DB server.
 *
 * Tune via environment variables without code changes:
 *   DB_POOL_MAX       — maximum simultaneous connections (default 10)
 *   DB_POOL_MIN       — minimum idle connections kept alive (default 2)
 *   DB_IDLE_TIMEOUT   — ms before an idle connection is released (default 30 000)
 *   DB_CONN_TIMEOUT   — ms to wait for a connection before erroring (default 5 000)
 *
 * For 10 000+ users and high concurrency, increase DB_POOL_MAX (up to the
 * PostgreSQL max_connections limit, usually 100) and consider pgBouncer in
 * front of the DB.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX ?? "10", 10),
  min: parseInt(process.env.DB_POOL_MIN ?? "2", 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT ?? "30000", 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT ?? "5000", 10),
});

pool.on("error", (err) => {
  console.error("PostgreSQL pool error:", err);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
