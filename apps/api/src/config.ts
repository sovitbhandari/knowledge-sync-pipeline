import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Load repo-root .env when running from apps/api
const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
loadEnv({ path: resolve(repoRoot, ".env") });
loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  SYNC_LEASE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  SYNC_MAX_RETRIES: z.coerce.number().int().nonnegative().default(5),
  SYNC_RETRY_BASE_MS: z.coerce.number().int().positive().default(200),
  SYNC_RETRY_MAX_MS: z.coerce.number().int().positive().default(10_000),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}
