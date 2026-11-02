import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { createDb } from "./db/client.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, pool } = createDb(config);
  const app = await buildApp({ config, db, pool });

  try {
    await app.listen({ host: config.API_HOST, port: config.API_PORT });
    app.log.info(
      { host: config.API_HOST, port: config.API_PORT },
      "API server listening",
    );
  } catch (error) {
    app.log.error({ err: error }, "failed to start API server");
    await pool.end();
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
