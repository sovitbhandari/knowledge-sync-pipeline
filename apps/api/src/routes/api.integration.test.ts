import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../config.js";
import { buildApp } from "../app.js";
import { createDb } from "../db/client.js";
import { MockLocationStore } from "../adapters/mock-rest/store.js";
import { ensureDataSource, resetSyncData } from "../sync/runner.js";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabaseUrl)("management API", () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createDb>["pool"];
  let db: ReturnType<typeof createDb>["db"];
  let store: MockLocationStore;

  beforeAll(async () => {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      API_HOST: "127.0.0.1",
      API_PORT: "3456",
    });
    store = new MockLocationStore({ totalRecords: 8, defaultPageSize: 4 });
    ({ db, pool } = createDb(config));
    app = await buildApp({ config, db, pool, mockStore: store });
    // Real listen so MockRestAdapter can HTTP-fetch /mock-source during POST /api/syncs.
    await app.listen({ host: "127.0.0.1", port: 3456 });
  });

  beforeEach(async () => {
    await resetSyncData(db);
    store.reset(8);
    await ensureDataSource(db, {
      key: "mock-rest",
      name: "Mock REST Source",
      adapterType: "mock-rest",
    });
    await ensureDataSource(db, {
      key: "csv-upload",
      name: "CSV Upload",
      adapterType: "csv",
    });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("POST /api/syncs then lists syncs and locations", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/syncs",
      payload: { sourceKey: "mock-rest", pageSize: 4 },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.data.status).toBe("completed");
    expect(body.data.insertedCount).toBe(8);

    const syncs = await app.inject({ method: "GET", url: "/api/syncs" });
    expect(syncs.statusCode).toBe(200);
    expect(syncs.json().total).toBeGreaterThanOrEqual(1);

    const detail = await app.inject({
      method: "GET",
      url: `/api/syncs/${body.data.id}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.insertedCount).toBe(8);

    const locations = await app.inject({ method: "GET", url: "/api/locations?pageSize=5" });
    expect(locations.statusCode).toBe(200);
    expect(locations.json().total).toBe(8);
    expect(locations.json().data).toHaveLength(5);

    const firstId = locations.json().data[0].id;
    const one = await app.inject({ method: "GET", url: `/api/locations/${firstId}` });
    expect(one.statusCode).toBe(200);
    expect(one.json().data.id).toBe(firstId);
  });
});
