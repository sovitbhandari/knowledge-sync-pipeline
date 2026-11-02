import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

loadEnv({ path: resolve(import.meta.dirname, "../../.env") });

const apiPort = Number(process.env.API_PORT ?? 3001);
const webPort = Number(process.env.WEB_PORT ?? 5173);
const repoRoot = resolve(import.meta.dirname, "../..");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "npm run dev -w @ksp/api",
      url: `http://127.0.0.1:${apiPort}/health/live`,
      reuseExistingServer: !process.env.CI,
      cwd: repoRoot,
      timeout: 120_000,
      env: {
        ...process.env,
        NODE_ENV: "development",
        LOG_LEVEL: "error",
      },
    },
    {
      command: "npm run dev -w @ksp/web",
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: !process.env.CI,
      cwd: repoRoot,
      timeout: 120_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
