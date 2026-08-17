import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

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
