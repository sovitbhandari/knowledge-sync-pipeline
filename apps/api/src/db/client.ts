import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AppConfig } from "../config.js";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDb>["db"];

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function createDb(config: AppConfig) {
  const pool = createPool(config.DATABASE_URL);
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export async function checkDatabaseReady(pool: pg.Pool): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    return true;
  } finally {
    client.release();
  }
}
