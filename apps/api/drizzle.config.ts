import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

loadEnv({ path: resolve(process.cwd(), "../../.env") });
loadEnv();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://ksp:ksp_dev_password@localhost:5432/knowledge_sync",
  },
  strict: true,
  verbose: true,
});
