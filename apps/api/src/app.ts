import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import type { AppConfig } from "./config.js";
import { checkDatabaseReady, type Database } from "./db/client.js";

export type AppDeps = {
  config: AppConfig;
  db: Database;
  pool: pg.Pool;
};

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.config.LOG_LEVEL,
      transport:
        deps.config.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
  });

  await app.register(cors, { origin: true });

  app.get("/health/live", async () => ({
    status: "ok",
    service: "knowledge-sync-pipeline-api",
  }));

  app.get("/health/ready", async (_request, reply) => {
    try {
      const ready = await checkDatabaseReady(deps.pool);
      if (!ready) {
        return reply.status(503).send({ status: "not_ready", database: "unreachable" });
      }
      return { status: "ready", database: "ok" };
    } catch (error) {
      app.log.error({ err: error }, "readiness check failed");
      return reply.status(503).send({ status: "not_ready", database: "error" });
    }
  });

  return app;
}
