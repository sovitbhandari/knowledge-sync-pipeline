import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { ZodError } from "zod";
import { registerMockSource } from "./adapters/mock-rest/plugin.js";
import type { MockLocationStore } from "./adapters/mock-rest/store.js";
import type { AppConfig } from "./config.js";
import { checkDatabaseReady, type Database } from "./db/client.js";
import { locationRoutes } from "./routes/locations.js";
import { syncRoutes } from "./routes/syncs.js";

export type AppDeps = {
  config: AppConfig;
  db: Database;
  pool: pg.Pool;
  mockStore?: MockLocationStore;
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
  await registerMockSource(app, { store: deps.mockStore });
  await app.register(syncRoutes, { db: deps.db, config: deps.config });
  await app.register(locationRoutes, { db: deps.db });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "validation_error",
        message: "Invalid request",
        issues: error.issues,
      });
    }

    const statusCode =
      typeof error === "object" && error && "statusCode" in error
        ? Number((error as { statusCode: number }).statusCode)
        : 500;

    if (statusCode >= 500) {
      app.log.error({ err: error }, "unhandled error");
    }

    return reply.status(statusCode).send({
      error: statusCode >= 500 ? "internal_error" : "request_error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  });

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
