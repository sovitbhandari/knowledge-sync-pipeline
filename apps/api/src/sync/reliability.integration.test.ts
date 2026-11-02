import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { MockRestAdapter } from "../adapters/mock-rest/client.js";
import { registerMockSource } from "../adapters/mock-rest/plugin.js";
import { MockLocationStore } from "../adapters/mock-rest/store.js";
import { loadConfig } from "../config.js";
import { createDb, type Database } from "../db/client.js";
import { dataSources, locations, syncEvents, syncRuns } from "../db/schema.js";
import { acquireSourceLease } from "./lease.js";
import { ensureDataSource, resetSyncData, runSync } from "./runner.js";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabaseUrl)("sync reliability integration", () => {
  let db: Database;
  let pool: ReturnType<typeof createDb>["pool"];
  let store: MockLocationStore;
  let mockBaseUrl: string;
  let mockApp: ReturnType<typeof Fastify>;

  const retryConfig = {
    SYNC_LEASE_TTL_SECONDS: 30,
    SYNC_MAX_RETRIES: 3,
    SYNC_RETRY_BASE_MS: 5,
    SYNC_RETRY_MAX_MS: 50,
  };

  beforeAll(async () => {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    });
    ({ db, pool } = createDb(config));

    store = new MockLocationStore({ totalRecords: 10, defaultPageSize: 5 });
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
    store.reset(10);
    await ensureDataSource(db, {
      key: "mock-rest",
      name: "Mock REST Source",
      adapterType: "mock-rest",
      config: { baseUrl: mockBaseUrl },
    });
  });

  afterAll(async () => {
    await mockApp.close();
    await pool.end();
  });

  it("5. an API timeout triggers bounded retry behavior", async () => {
    store.setConfig({
      faultMode: "timeout",
      faultRemaining: 2,
      delayMs: 120,
    });
    const sleep = vi.fn(async () => undefined);
    const adapter = new MockRestAdapter({ baseUrl: mockBaseUrl, timeoutMs: 40 });

    const result = await runSync({
      db,
      sourceKey: "mock-rest",
      adapter,
      pageSize: 5,
      config: { ...retryConfig, SYNC_MAX_RETRIES: 5 },
      sleep,
      random: () => 0,
    });

    expect(result.status).toBe("completed");
    expect(result.failureReason).toBeNull();
    expect(result.retryCount).toBeGreaterThanOrEqual(2);
    expect(sleep).toHaveBeenCalled();
    const rows = await db.select().from(locations);
    expect(rows).toHaveLength(10);
  });

  it("6. HTTP 429 handling respects a valid Retry-After header", async () => {
    store.setConfig({
      faultMode: "rate_limit",
      faultRemaining: 1,
      rateLimitRetryAfterSeconds: 2,
      delayMs: 0,
    });
    const delays: number[] = [];
    const adapter = new MockRestAdapter({ baseUrl: mockBaseUrl, timeoutMs: 1_000 });

    const result = await runSync({
      db,
      sourceKey: "mock-rest",
      adapter,
      pageSize: 5,
      config: { ...retryConfig, SYNC_RETRY_MAX_MS: 5_000 },
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 0,
    });

    expect(result.status).toBe("completed");
    expect(result.retryCount).toBeGreaterThanOrEqual(1);
    expect(delays.some((d) => d === 2000)).toBe(true);
  });

  it("7. an interruption after a committed page resumes without skipping records", async () => {
    const adapter = new MockRestAdapter({ baseUrl: mockBaseUrl });
    const first = await runSync({
      db,
      sourceKey: "mock-rest",
      adapter,
      pageSize: 5,
      interruptAfterPages: 1,
      config: retryConfig,
    });

    expect(first.status).toBe("failed");
    expect(first.failureCategory).toBe("interrupted");
    expect(first.inserted).toBe(5);

    const resumed = await runSync({
      db,
      sourceKey: "mock-rest",
      adapter,
      pageSize: 5,
      resumeRunId: first.syncRunId,
      config: retryConfig,
    });

    expect(resumed.status).toBe("completed");
    // Cumulative counts on the resumed run: 5 from first page + 5 from remainder.
    expect(resumed.inserted).toBe(10);
    expect(resumed.unchanged).toBe(0);

    const rows = await db.select().from(locations);
    expect(rows).toHaveLength(10);
    const externalIds = rows.map((r) => r.externalId).sort();
    expect(externalIds[0]).toBe("loc-000001");
    expect(externalIds[9]).toBe("loc-000010");

    const run = await db.query.syncRuns.findFirst({
      where: eq(syncRuns.id, first.syncRunId),
    });
    expect(run?.status).toBe("completed");
  });

  it("8. two concurrent attempts cannot run the same source synchronization simultaneously", async () => {
    const source = await db.query.dataSources.findFirst({
      where: eq(dataSources.key, "mock-rest"),
    });
    expect(source).toBeTruthy();

    await acquireSourceLease(db, {
      sourceId: source!.id,
      owner: "worker-a",
      ttlSeconds: 60,
    });

    const adapter = new MockRestAdapter({ baseUrl: mockBaseUrl });
    const result = await runSync({
      db,
      sourceKey: "mock-rest",
      adapter,
      workerId: "worker-b",
      config: retryConfig,
    });

    expect(result.status).toBe("failed");
    expect(result.failureCategory).toBe("lease_conflict");
    expect(result.failureReason).toMatch(/lease held/i);
  });

  it("9. an expired lease can be recovered", async () => {
    const source = await db.query.dataSources.findFirst({
      where: eq(dataSources.key, "mock-rest"),
    });
    expect(source).toBeTruthy();

    await db
      .update(dataSources)
      .set({
        leaseOwner: "dead-worker",
        leaseExpiresAt: new Date(Date.now() - 60_000),
        updatedAt: new Date(),
      })
      .where(eq(dataSources.id, source!.id));

    const adapter = new MockRestAdapter({ baseUrl: mockBaseUrl });
    const result = await runSync({
      db,
      sourceKey: "mock-rest",
      adapter,
      workerId: "recovery-worker",
      config: retryConfig,
    });

    expect(result.status).toBe("completed");
    expect(result.inserted).toBe(10);

    const events = await db.select().from(syncEvents);
    expect(events.some((e) => e.eventType === "lease_acquired")).toBe(true);
  });

  it("10. a permanent failure reaches a terminal state without an infinite retry loop", async () => {
    store.setConfig({
      faultMode: "malformed_json",
      faultRemaining: null,
    });
    const sleep = vi.fn(async () => undefined);
    const adapter = new MockRestAdapter({ baseUrl: mockBaseUrl, timeoutMs: 1_000 });

    const result = await runSync({
      db,
      sourceKey: "mock-rest",
      adapter,
      pageSize: 5,
      config: { ...retryConfig, SYNC_MAX_RETRIES: 10 },
      sleep,
    });

    expect(result.status).toBe("failed");
    expect(result.failureCategory).toBe("permanent_source_error");
    expect(result.retryCount).toBe(0);
    expect(sleep).not.toHaveBeenCalled();

    const run = await db.query.syncRuns.findFirst({
      where: eq(syncRuns.id, result.syncRunId),
    });
    expect(run?.status).toBe("failed");
    expect(run?.failureReason).toBeTruthy();
  });
});
