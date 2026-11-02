import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { locationsToCsv, CsvAdapter } from "../adapters/csv/adapter.js";
import { MockRestAdapter } from "../adapters/mock-rest/client.js";
import { mutateLocationName } from "../adapters/mock-rest/fixtures.js";
import { registerMockSource } from "../adapters/mock-rest/plugin.js";
import { MockLocationStore } from "../adapters/mock-rest/store.js";
import { loadConfig } from "../config.js";
import { createDb, type Database } from "../db/client.js";
import { locations, rejectedRecords } from "../db/schema.js";
import { ensureDataSource, resetSyncData, runSync } from "./runner.js";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabaseUrl)("sync integration", () => {
  let db: Database;
  let pool: ReturnType<typeof createDb>["pool"];
  let store: MockLocationStore;
  let mockBaseUrl: string;
  let mockApp: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    });
    ({ db, pool } = createDb(config));

    store = new MockLocationStore({ totalRecords: 12, defaultPageSize: 5 });
    mockApp = Fastify({ logger: false });
    await registerMockSource(mockApp, { store, prefix: "/mock-source" });
    await mockApp.listen({ host: "127.0.0.1", port: 0 });
    const address = mockApp.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind mock source server");
    }
    mockBaseUrl = `http://127.0.0.1:${address.port}/mock-source`;
  });

  beforeEach(async () => {
    await resetSyncData(db);
    store.reset(12);
    await ensureDataSource(db, {
      key: "mock-rest",
      name: "Mock REST Source",
      adapterType: "mock-rest",
      config: { baseUrl: mockBaseUrl },
    });
    await ensureDataSource(db, {
      key: "csv-upload",
      name: "CSV Upload",
      adapterType: "csv",
    });
  });

  afterAll(async () => {
    await mockApp.close();
    await pool.end();
  });

  it("1. first import inserts all valid records", async () => {
    const adapter = new MockRestAdapter({ baseUrl: mockBaseUrl, timeoutMs: 2_000 });
    const result = await runSync({
      db,
      sourceKey: "mock-rest",
      adapter,
      pageSize: 5,
    });

    expect(result.status).toBe("completed");
    expect(result.inserted).toBe(12);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);
    expect(result.rejected).toBe(0);

    const rows = await db.select().from(locations);
    expect(rows).toHaveLength(12);
  });

  it("2. repeating an identical import produces no duplicate locations", async () => {
    const adapter = new MockRestAdapter({ baseUrl: mockBaseUrl });
    await runSync({ db, sourceKey: "mock-rest", adapter, pageSize: 5 });
    const second = await runSync({ db, sourceKey: "mock-rest", adapter, pageSize: 5 });

    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(12);
    expect(second.rejected).toBe(0);

    const rows = await db.select().from(locations);
    expect(rows).toHaveLength(12);
  });

  it("3. a changed source record updates only the corresponding canonical record", async () => {
    const adapter = new MockRestAdapter({ baseUrl: mockBaseUrl });
    await runSync({ db, sourceKey: "mock-rest", adapter, pageSize: 5 });

    const page = store.listPage(null, 100);
    const target = page.records[0]!;
    const othersHash = new Map(
      (
        await db.select({ externalId: locations.externalId, hash: locations.contentHash }).from(locations)
      ).map((r) => [r.externalId, r.hash]),
    );

    store.upsert(mutateLocationName(target, "Updated Demo Business"));
    const third = await runSync({ db, sourceKey: "mock-rest", adapter, pageSize: 5 });

    expect(third.updated).toBe(1);
    expect(third.unchanged).toBe(11);
    expect(third.inserted).toBe(0);

    const updated = await db.query.locations.findFirst({
      where: eq(locations.externalId, target.external_id),
    });
    expect(updated?.name).toBe("Updated Demo Business");

    const after = await db
      .select({ externalId: locations.externalId, hash: locations.contentHash, name: locations.name })
      .from(locations);
    for (const row of after) {
      if (row.externalId === target.external_id) continue;
      expect(row.hash).toBe(othersHash.get(row.externalId));
    }
  });

  it("4. malformed records are rejected with an auditable reason", async () => {
    const page = store.listPage(null, 100);
    const bad = {
      ...page.records[1]!,
      address_line1: " ",
      city: "",
    };
    store.upsert(bad);

    const adapter = new MockRestAdapter({ baseUrl: mockBaseUrl });
    const result = await runSync({ db, sourceKey: "mock-rest", adapter, pageSize: 5 });

    expect(result.rejected).toBe(1);
    expect(result.inserted).toBe(11);

    const rejected = await db.select().from(rejectedRecords);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatch(/normalization|validation/i);
    expect(rejected[0]?.validationErrors).toBeTruthy();
  });

  it("11. CSV and REST ingestion produce equivalent canonical records", async () => {
    const restAdapter = new MockRestAdapter({ baseUrl: mockBaseUrl });
    const restResult = await runSync({
      db,
      sourceKey: "mock-rest",
      adapter: restAdapter,
      pageSize: 5,
    });
    expect(restResult.status).toBe("completed");

    const restRows = await db.select().from(locations);
    const restByExternal = new Map(
      restRows.map((r) => [r.externalId, r.contentHash] as const),
    );

    // Fresh source for CSV path
    await resetSyncData(db);
    await ensureDataSource(db, {
      key: "csv-upload",
      name: "CSV Upload",
      adapterType: "csv",
    });

    const csvText = locationsToCsv(store.getAll());
    const csvAdapter = new CsvAdapter({ csvText });
    const csvResult = await runSync({
      db,
      sourceKey: "csv-upload",
      adapter: csvAdapter,
      pageSize: 5,
    });

    expect(csvResult.status).toBe("completed");
    expect(csvResult.inserted).toBe(restResult.inserted);

    const csvRows = await db.select().from(locations);
    expect(csvRows).toHaveLength(restRows.length);

    for (const row of csvRows) {
      expect(restByExternal.get(row.externalId)).toBe(row.contentHash);
    }
  });
});
