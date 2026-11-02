import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { loadConfig } from "../config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const migrationsFolder = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../drizzle");

  const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  const db = drizzle(pool);

  console.log(`Applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied successfully");

  await pool.end();
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
