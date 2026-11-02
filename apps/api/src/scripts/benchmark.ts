import { cpus, totalmem } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { MockRestAdapter } from "../adapters/mock-rest/client.js";
import { registerMockSource } from "../adapters/mock-rest/plugin.js";
import { MockLocationStore } from "../adapters/mock-rest/store.js";
import { ensureDataSource, resetSyncData, runSync } from "../sync/runner.js";

type BenchResult = {
  records: number;
  pageSize: number;
  durationMs: number;
  recordsPerSecond: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
  retryCount: number;
};

async function runOne(opts: {
  db: ReturnType<typeof createDb>["db"];
  baseUrl: string;
  records: number;
  pageSize: number;
  store: MockLocationStore;
}): Promise<BenchResult> {
  await resetSyncData(opts.db);
  opts.store.reset(opts.records);
  await ensureDataSource(opts.db, {
    key: "mock-rest",
    name: "Mock REST Source",
    adapterType: "mock-rest",
  });

  const adapter = new MockRestAdapter({ baseUrl: opts.baseUrl, timeoutMs: 30_000 });
  const started = Date.now();
  const result = await runSync({
    db: opts.db,
    sourceKey: "mock-rest",
    adapter,
    pageSize: opts.pageSize,
    config: {
      SYNC_LEASE_TTL_SECONDS: 120,
      SYNC_MAX_RETRIES: 3,
      SYNC_RETRY_BASE_MS: 20,
      SYNC_RETRY_MAX_MS: 500,
    },
  });
  const durationMs = Date.now() - started;
  if (result.status !== "completed") {
    throw new Error(`Benchmark sync failed: ${result.failureReason}`);
  }

  const processed = result.inserted + result.updated + result.unchanged + result.rejected;
  return {
    records: opts.records,
    pageSize: opts.pageSize,
    durationMs,
    recordsPerSecond: durationMs > 0 ? Math.round((processed / durationMs) * 1000) : processed,
    inserted: result.inserted,
    updated: result.updated,
    unchanged: result.unchanged,
    rejected: result.rejected,
    retryCount: result.retryCount,
  };
}

async function main(): Promise<void> {
  const sizes = (process.argv[2] ?? "1000,10000,50000")
    .split(",")
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  const pageSize = Number.parseInt(process.argv[3] ?? "200", 10);

  const config = loadConfig({
    ...process.env,
    LOG_LEVEL: "error",
    NODE_ENV: "test",
  });
  const { db, pool } = createDb(config);
  const store = new MockLocationStore({ totalRecords: sizes[0] ?? 1000, defaultPageSize: pageSize });

  const mockApp = Fastify({ logger: false });
  await registerMockSource(mockApp, { store, prefix: "/mock-source" });
  await mockApp.listen({ host: "127.0.0.1", port: 0 });
  const address = mockApp.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind benchmark mock source");
  }
  const baseUrl = `http://127.0.0.1:${address.port}/mock-source`;

  const results: BenchResult[] = [];
  for (const records of sizes) {
    console.error(`Benchmarking ${records} records...`);
    const result = await runOne({ db, baseUrl, records, pageSize, store });
    results.push(result);
    console.error(
      `  ${records}: ${result.durationMs}ms, ${result.recordsPerSecond} records/s (inserted=${result.inserted})`,
    );
  }

  const report = {
    measuredAt: new Date().toISOString(),
    hardware: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpuCount: cpus().length,
      cpuModel: cpus()[0]?.model ?? "unknown",
      totalMemoryGb: Math.round((totalmem() / 1024 / 1024 / 1024) * 10) / 10,
    },
    configuration: {
      database: "PostgreSQL via DATABASE_URL",
      pageSize,
      adapter: "mock-rest (in-process Fastify fixture)",
      measurement:
        "Wall-clock duration around runSync for a cold full import after TRUNCATE; records/s = processed/duration",
    },
    results,
    disclaimer:
      "Experimental local measurements only. Not production performance, capacity, or business-impact claims.",
  };

  const outDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../benchmarks/results");
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, `bench-${Date.now()}.json`);
  await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(report, null, 2));
  console.error(`Wrote ${outFile}`);

  await mockApp.close();
  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
