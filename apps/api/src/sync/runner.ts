import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { SourceAdapter } from "../adapters/types.js";
import type { Database } from "../db/client.js";
import { dataSources, syncCheckpoints, syncEvents, syncRuns } from "../db/schema.js";
import { persistPage } from "./persist.js";
import type { SyncMode, SyncRunResult } from "./types.js";

export type SyncRunnerOptions = {
  db: Database;
  sourceKey: string;
  adapter: SourceAdapter;
  mode?: SyncMode;
  pageSize?: number;
  correlationId?: string;
};

export async function runSync(opts: SyncRunnerOptions): Promise<SyncRunResult> {
  const started = Date.now();
  const correlationId = opts.correlationId ?? randomUUID();
  const pageSize = opts.pageSize ?? 50;
  const mode = opts.mode ?? "full";

  const source = await opts.db.query.dataSources.findFirst({
    where: eq(dataSources.key, opts.sourceKey),
  });
  if (!source) {
    throw new Error(`Unknown data source key '${opts.sourceKey}'`);
  }
  if (!source.isActive) {
    throw new Error(`Data source '${opts.sourceKey}' is inactive`);
  }

  const [run] = await opts.db
    .insert(syncRuns)
    .values({
      sourceId: source.id,
      mode,
      status: "running",
      startedAt: new Date(),
      correlationId,
    })
    .returning();

  if (!run) {
    throw new Error("Failed to create sync run");
  }

  await opts.db.insert(syncEvents).values({
    syncRunId: run.id,
    eventType: "run_started",
    message: `Sync started for source ${opts.sourceKey}`,
    details: { mode, pageSize, correlationId },
  });

  await opts.db.insert(syncCheckpoints).values({
    syncRunId: run.id,
    sourceId: source.id,
    cursor: { value: null },
    pageNumber: 0,
    recordsCommitted: 0,
  });

  let cursor: string | null = null;
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let rejected = 0;
  let recordsCommitted = 0;

  try {
    for (;;) {
      const page = await opts.adapter.fetchPage(cursor, pageSize);
      const pageCounts = await persistPage({
        db: opts.db,
        sourceId: source.id,
        syncRunId: run.id,
        records: page.records,
      });

      inserted += pageCounts.inserted;
      updated += pageCounts.updated;
      unchanged += pageCounts.unchanged;
      rejected += pageCounts.rejected;
      recordsCommitted += page.records.length;
      cursor = page.nextCursor;

      await opts.db
        .update(syncCheckpoints)
        .set({
          cursor: { value: cursor },
          pageNumber: page.pageNumber,
          recordsCommitted,
          updatedAt: new Date(),
        })
        .where(eq(syncCheckpoints.syncRunId, run.id));

      await opts.db
        .update(syncRuns)
        .set({
          insertedCount: inserted,
          updatedCount: updated,
          unchangedCount: unchanged,
          rejectedCount: rejected,
          updatedAt: new Date(),
        })
        .where(eq(syncRuns.id, run.id));

      await opts.db.insert(syncEvents).values({
        syncRunId: run.id,
        eventType: "page_committed",
        message: `Committed page ${page.pageNumber}`,
        details: { ...pageCounts, nextCursor: cursor },
      });

      if (cursor == null) break;
    }

    const durationMs = Date.now() - started;
    const processed = inserted + updated + unchanged + rejected;
    const recordsPerSecond =
      durationMs > 0 ? Math.round((processed / durationMs) * 1000) : processed;

    await opts.db
      .update(syncRuns)
      .set({
        status: "completed",
        finishedAt: new Date(),
        durationMs,
        recordsPerSecond,
        insertedCount: inserted,
        updatedCount: updated,
        unchangedCount: unchanged,
        rejectedCount: rejected,
        updatedAt: new Date(),
      })
      .where(eq(syncRuns.id, run.id));

    await opts.db.insert(syncEvents).values({
      syncRunId: run.id,
      eventType: "run_completed",
      message: "Sync completed",
      details: { inserted, updated, unchanged, rejected, durationMs },
    });

    return {
      syncRunId: run.id,
      sourceId: source.id,
      status: "completed",
      failureReason: null,
      inserted,
      updated,
      unchanged,
      rejected,
      durationMs,
      recordsPerSecond,
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    const reason = error instanceof Error ? error.message : String(error);

    await opts.db
      .update(syncRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        durationMs,
        failureCategory: "source_error",
        failureReason: reason,
        insertedCount: inserted,
        updatedCount: updated,
        unchangedCount: unchanged,
        rejectedCount: rejected,
        updatedAt: new Date(),
      })
      .where(eq(syncRuns.id, run.id));

    await opts.db.insert(syncEvents).values({
      syncRunId: run.id,
      eventType: "run_failed",
      message: reason,
      details: { error: reason },
    });

    return {
      syncRunId: run.id,
      sourceId: source.id,
      status: "failed",
      failureReason: reason,
      inserted,
      updated,
      unchanged,
      rejected,
      durationMs,
      recordsPerSecond: null,
    };
  }
}

export async function ensureDataSource(
  db: Database,
  input: {
    key: string;
    name: string;
    adapterType: string;
    config?: Record<string, unknown>;
  },
): Promise<string> {
  const existing = await db.query.dataSources.findFirst({
    where: eq(dataSources.key, input.key),
  });
  if (existing) return existing.id;

  const [created] = await db
    .insert(dataSources)
    .values({
      key: input.key,
      name: input.name,
      adapterType: input.adapterType,
      config: input.config ?? {},
    })
    .returning({ id: dataSources.id });

  if (!created) {
    throw new Error(`Failed to create data source ${input.key}`);
  }
  return created.id;
}

/** Test helper: wipe sync/location tables while keeping schema. */
export async function resetSyncData(db: Database): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE
    sync_events,
    rejected_records,
    source_records,
    sync_checkpoints,
    sync_runs,
    locations,
    data_sources
    RESTART IDENTITY CASCADE`);
}
