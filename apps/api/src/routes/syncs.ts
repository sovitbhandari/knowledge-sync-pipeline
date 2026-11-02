import type { FastifyPluginAsync } from "fastify";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { CsvAdapter } from "../adapters/csv/adapter.js";
import { MockRestAdapter } from "../adapters/mock-rest/client.js";
import type { SourceAdapter } from "../adapters/types.js";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";
import {
  dataSources,
  rejectedRecords,
  syncEvents,
  syncRuns,
} from "../db/schema.js";
import { ensureDataSource, runSync } from "../sync/runner.js";

const createSyncSchema = z.object({
  sourceKey: z.enum(["mock-rest", "csv-upload"]),
  mode: z.enum(["full", "incremental"]).default("full"),
  pageSize: z.number().int().positive().max(500).optional(),
  resumeRunId: z.string().uuid().optional(),
  csvText: z.string().min(1).optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sourceKey: z.string().optional(),
});

export type SyncRoutesOpts = {
  db: Database;
  config: AppConfig;
};

function buildAdapter(opts: {
  sourceKey: string;
  config: AppConfig;
  csvText?: string;
}): SourceAdapter {
  if (opts.sourceKey === "csv-upload") {
    if (!opts.csvText) {
      throw Object.assign(new Error("csvText is required for csv-upload"), { statusCode: 400 });
    }
    return new CsvAdapter({ csvText: opts.csvText });
  }

  const host =
    opts.config.API_HOST === "0.0.0.0" || opts.config.API_HOST === "::"
      ? "127.0.0.1"
      : opts.config.API_HOST;
  const baseUrl = `http://${host}:${opts.config.API_PORT}/mock-source`;
  return new MockRestAdapter({ baseUrl });
}

export const syncRoutes: FastifyPluginAsync<SyncRoutesOpts> = async (app, opts) => {
  await ensureDataSource(opts.db, {
    key: "mock-rest",
    name: "Mock REST Source",
    adapterType: "mock-rest",
  });
  await ensureDataSource(opts.db, {
    key: "csv-upload",
    name: "CSV Upload",
    adapterType: "csv",
  });

  app.get("/api/sources", async () => {
    const rows = await opts.db.select().from(dataSources).orderBy(dataSources.key);
    return {
      data: rows.map((row) => ({
        id: row.id,
        key: row.key,
        name: row.name,
        adapterType: row.adapterType,
        isActive: row.isActive,
        leaseOwner: row.leaseOwner,
        leaseExpiresAt: row.leaseExpiresAt,
      })),
    };
  });

  app.post("/api/syncs", async (request, reply) => {
    const body = createSyncSchema.parse(request.body);
    await ensureDataSource(opts.db, {
      key: "mock-rest",
      name: "Mock REST Source",
      adapterType: "mock-rest",
    });
    await ensureDataSource(opts.db, {
      key: "csv-upload",
      name: "CSV Upload",
      adapterType: "csv",
    });

    let adapter: SourceAdapter;
    try {
      adapter = buildAdapter({
        sourceKey: body.sourceKey,
        config: opts.config,
        csvText: body.csvText,
      });
    } catch (error) {
      const statusCode =
        error && typeof error === "object" && "statusCode" in error
          ? Number((error as { statusCode: number }).statusCode)
          : 400;
      return reply.status(statusCode).send({
        error: "invalid_request",
        message: error instanceof Error ? error.message : "Invalid sync request",
      });
    }

    const result = await runSync({
      db: opts.db,
      sourceKey: body.sourceKey,
      adapter,
      mode: body.mode,
      pageSize: body.pageSize,
      resumeRunId: body.resumeRunId,
      config: opts.config,
    });

    const httpStatus =
      result.failureCategory === "lease_conflict"
        ? 409
        : result.status === "failed"
          ? 422
          : 201;

    return reply.status(httpStatus).send({
      data: {
        id: result.syncRunId,
        sourceId: result.sourceId,
        status: result.status,
        insertedCount: result.inserted,
        updatedCount: result.updated,
        unchangedCount: result.unchanged,
        rejectedCount: result.rejected,
        retryCount: result.retryCount,
        durationMs: result.durationMs,
        recordsPerSecond: result.recordsPerSecond,
        failureCategory: result.failureCategory,
        failureReason: result.failureReason,
      },
    });
  });

  app.get("/api/syncs", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const conditions = [];
    if (query.sourceKey) {
      const source = await opts.db.query.dataSources.findFirst({
        where: eq(dataSources.key, query.sourceKey),
      });
      if (!source) {
        return { data: [], page: query.page, pageSize: query.pageSize, total: 0 };
      }
      conditions.push(eq(syncRuns.sourceId, source.id));
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const totalRows = await opts.db.select({ total: count() }).from(syncRuns).where(where);
    const total = totalRows[0]?.total ?? 0;

    const rows = await opts.db
      .select({
        run: syncRuns,
        sourceKey: dataSources.key,
        sourceName: dataSources.name,
      })
      .from(syncRuns)
      .innerJoin(dataSources, eq(syncRuns.sourceId, dataSources.id))
      .where(where)
      .orderBy(desc(syncRuns.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return {
      data: rows.map(({ run, sourceKey, sourceName }) => ({
        id: run.id,
        sourceKey,
        sourceName,
        mode: run.mode,
        status: run.status,
        insertedCount: run.insertedCount,
        updatedCount: run.updatedCount,
        unchangedCount: run.unchangedCount,
        rejectedCount: run.rejectedCount,
        retryCount: run.retryCount,
        durationMs: run.durationMs,
        recordsPerSecond: run.recordsPerSecond,
        failureCategory: run.failureCategory,
        failureReason: run.failureReason,
        correlationId: run.correlationId,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        createdAt: run.createdAt,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total: Number(total),
    };
  });

  app.get("/api/syncs/overview/latest", async () => {
    const latest = await opts.db
      .select({
        run: syncRuns,
        sourceKey: dataSources.key,
        sourceName: dataSources.name,
      })
      .from(syncRuns)
      .innerJoin(dataSources, eq(syncRuns.sourceId, dataSources.id))
      .orderBy(desc(syncRuns.createdAt))
      .limit(1);

    const [totals] = await opts.db
      .select({
        totalRuns: count(),
        completedRuns: sql<number>`count(*) filter (where ${syncRuns.status} = 'completed')`,
        failedRuns: sql<number>`count(*) filter (where ${syncRuns.status} = 'failed')`,
      })
      .from(syncRuns);

    return {
      data: {
        latest: latest[0]
          ? {
              id: latest[0].run.id,
              sourceKey: latest[0].sourceKey,
              sourceName: latest[0].sourceName,
              status: latest[0].run.status,
              insertedCount: latest[0].run.insertedCount,
              updatedCount: latest[0].run.updatedCount,
              unchangedCount: latest[0].run.unchangedCount,
              rejectedCount: latest[0].run.rejectedCount,
              finishedAt: latest[0].run.finishedAt,
              failureReason: latest[0].run.failureReason,
            }
          : null,
        totals: {
          totalRuns: Number(totals?.totalRuns ?? 0),
          completedRuns: Number(totals?.completedRuns ?? 0),
          failedRuns: Number(totals?.failedRuns ?? 0),
        },
      },
    };
  });

  app.get("/api/syncs/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const row = await opts.db
      .select({
        run: syncRuns,
        sourceKey: dataSources.key,
        sourceName: dataSources.name,
      })
      .from(syncRuns)
      .innerJoin(dataSources, eq(syncRuns.sourceId, dataSources.id))
      .where(eq(syncRuns.id, params.id))
      .limit(1);

    const match = row[0];
    if (!match) {
      return reply.status(404).send({ error: "not_found", message: "Sync run not found" });
    }

    const rejected = await opts.db
      .select({
        id: rejectedRecords.id,
        externalId: rejectedRecords.externalId,
        reason: rejectedRecords.reason,
        validationErrors: rejectedRecords.validationErrors,
        rejectedAt: rejectedRecords.rejectedAt,
      })
      .from(rejectedRecords)
      .where(eq(rejectedRecords.syncRunId, params.id))
      .orderBy(desc(rejectedRecords.rejectedAt))
      .limit(100);

    const events = await opts.db
      .select({
        id: syncEvents.id,
        eventType: syncEvents.eventType,
        message: syncEvents.message,
        details: syncEvents.details,
        createdAt: syncEvents.createdAt,
      })
      .from(syncEvents)
      .where(eq(syncEvents.syncRunId, params.id))
      .orderBy(desc(syncEvents.createdAt))
      .limit(100);

    const { run, sourceKey, sourceName } = match;
    return {
      data: {
        id: run.id,
        sourceKey,
        sourceName,
        mode: run.mode,
        status: run.status,
        insertedCount: run.insertedCount,
        updatedCount: run.updatedCount,
        unchangedCount: run.unchangedCount,
        rejectedCount: run.rejectedCount,
        retryCount: run.retryCount,
        durationMs: run.durationMs,
        recordsPerSecond: run.recordsPerSecond,
        failureCategory: run.failureCategory,
        failureReason: run.failureReason,
        correlationId: run.correlationId,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        createdAt: run.createdAt,
        rejectedRecords: rejected,
        events,
      },
    };
  });
};
