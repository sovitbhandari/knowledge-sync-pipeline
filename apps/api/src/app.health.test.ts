import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { createDb } from "./db/client.js";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabaseUrl)("health endpoints (integration)", () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createDb>["pool"];

  beforeAll(async () => {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    });
    const dbBundle = createDb(config);
    pool = dbBundle.pool;
    app = await buildApp({ config, db: dbBundle.db, pool });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("GET /health/live returns ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
  });

  it("GET /health/ready reports database connectivity", async () => {
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ready", database: "ok" });
  });
});
