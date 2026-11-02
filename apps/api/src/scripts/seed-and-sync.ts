import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { MockRestAdapter } from "../adapters/mock-rest/client.js";
import { defaultMockStore } from "../adapters/mock-rest/store.js";
import { ensureDataSource, runSync } from "../sync/runner.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, pool } = createDb(config);

  const total = Number.parseInt(process.argv[2] ?? "25", 10);
  defaultMockStore.reset(Number.isFinite(total) ? total : 25);

  const mockBaseUrl = `http://${config.API_HOST === "0.0.0.0" ? "127.0.0.1" : config.API_HOST}:${config.API_PORT}/mock-source`;

  await ensureDataSource(db, {
    key: "mock-rest",
    name: "Mock REST Source",
    adapterType: "mock-rest",
    config: { baseUrl: mockBaseUrl, totalRecords: defaultMockStore.getConfig().totalRecords },
  });

  const adapter = new MockRestAdapter({ baseUrl: mockBaseUrl });
  const result = await runSync({
    db,
    sourceKey: "mock-rest",
    adapter,
    pageSize: 10,
  });

  console.log(JSON.stringify(result, null, 2));
  await pool.end();

  if (result.status !== "completed") {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
