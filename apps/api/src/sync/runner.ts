import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { SourceAdapter } from "../adapters/types.js";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";
import { dataSources, syncCheckpoints, syncEvents, syncRuns } from "../db/schema.js";
import {
  LeaseConflictError,
  acquireSourceLease,
  releaseSourceLease,
  renewSourceLease,
} from "./lease.js";
import { persistPage } from "./persist.js";
import { withRetries } from "./retry.js";
import type { SyncMode, SyncRunResult } from "./types.js";

export type SyncRunnerOptions = {
  db: Database;
  sourceKey: string;
  adapter: SourceAdapter;
  mode?: SyncMode;
  pageSize?: number;
  correlationId?: string;
  workerId?: string;
  /** Resume an existing run from its checkpoint. */
  resumeRunId?: string;
  /** Throw after N committed pages (test hook for interruption). */
  interruptAfterPages?: number;
  config?: Pick<
    AppConfig,
    "SYNC_LEASE_TTL_SECONDS" | "SYNC_MAX_RETRIES" | "SYNC_RETRY_BASE_MS" | "SYNC_RETRY_MAX_MS"
  >;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

function runnerConfig(opts: SyncRunnerOptions) {
  return {
    SYNC_LEASE_TTL_SECONDS: opts.config?.SYNC_LEASE_TTL_SECONDS ?? 60,
    SYNC_MAX_RETRIES: opts.config?.SYNC_MAX_RETRIES ?? 5,
    SYNC_RETRY_BASE_MS: opts.config?.SYNC_RETRY_BASE_MS ?? 200,
    SYNC_RETRY_MAX_MS: opts.config?.SYNC_RETRY_MAX_MS ?? 10_000,
  };
}

export async function runSync(opts: SyncRunnerOptions): Promise<SyncRunResult> {
  const started = Date.now();
  const correlationId = opts.correlationId ?? randomUUID();
  const workerId = opts.workerId ?? `worker-${randomUUID()}`;
  const pageSize = opts.pageSize ?? 50;
  const mode = opts.mode ?? "full";
  const cfg = runnerConfig(opts);

  const source = await opts.db.query.dataSources.findFirst({
    where: eq(dataSources.key, opts.sourceKey),
  });
  if (!source) {
    throw new Error(`Unknown data source key '${opts.sourceKey}'`);
  }
  if (!source.isActive) {
    throw new Error(`Data source '${opts.sourceKey}' is inactive`);
  }

  let run = opts.resumeRunId
    ? await opts.db.query.syncRuns.findFirst({ where: eq(syncRuns.id, opts.resumeRunId) })
    : null;

  if (opts.resumeRunId && !run) {
    throw new Error(`Cannot resume unknown sync run '${opts.resumeRunId}'`);
  }
  if (run && run.sourceId !== source.id) {
    throw new Error("Resume run does not belong to the requested source");
  }

  // Acquire source lease before mutating run state (also recovers expired leases).
  let lease;
  try {
    lease = await acquireSourceLease(opts.db, {
      sourceId: source.id,
      owner: workerId,
      ttlSeconds: cfg.SYNC_LEASE_TTL_SECONDS,
      syncRunId: run?.id ?? null,
    });
  } catch (error) {
    if (error instanceof LeaseConflictError) {
      return {
        syncRunId: run?.id ?? "00000000-0000-0000-0000-000000000000",
        sourceId: source.id,
        status: "failed",
        failureReason: error.message,
        failureCategory: "lease_conflict",
        inserted: 0,
        updated: 0,
        unchanged: 0,
        rejected: 0,
        retryCount: 0,
        durationMs: Date.now() - started,
        recordsPerSecond: null,
      };
    }
    throw error;
  }

  if (!run) {
    const [created] = await opts.db
      .insert(syncRuns)
      .values({
        sourceId: source.id,
        mode,
        status: "running",
        startedAt: new Date(),
        correlationId,
        leaseOwner: workerId,
        leaseExpiresAt: lease.expiresAt,
      })
      .returning();
    if (!created) {
      await releaseSourceLease(opts.db, { sourceId: source.id, owner: workerId });
      throw new Error("Failed to create sync run");
    }
    run = created;

    await opts.db.insert(syncCheckpoints).values({
      syncRunId: run.id,
      sourceId: source.id,
      cursor: { value: null },
      pageNumber: 0,
      recordsCommitted: 0,
    });
  } else {
    await opts.db
      .update(syncRuns)
      .set({
        status: "running",
        failureCategory: null,
        failureReason: null,
        finishedAt: null,
        leaseOwner: workerId,
        leaseExpiresAt: lease.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(syncRuns.id, run.id));
  }

  lease = await acquireSourceLease(opts.db, {
    sourceId: source.id,
    owner: workerId,
    ttlSeconds: cfg.SYNC_LEASE_TTL_SECONDS,
    syncRunId: run.id,
  });

  await opts.db.insert(syncEvents).values({
    syncRunId: run.id,
    eventType: "lease_acquired",
    message: `Lease acquired by ${workerId}`,
    details: {
      workerId,
      expiresAt: lease.expiresAt.toISOString(),
      resumed: Boolean(opts.resumeRunId),
    },
  });

  await opts.db.insert(syncEvents).values({
    syncRunId: run.id,
    eventType: "run_started",
    message: `Sync started for source ${opts.sourceKey}`,
    details: { mode, pageSize, correlationId, workerId },
  });

  const checkpoint = await opts.db.query.syncCheckpoints.findFirst({
    where: eq(syncCheckpoints.syncRunId, run.id),
  });

  let cursor: string | null =
    checkpoint && checkpoint.cursor && typeof checkpoint.cursor === "object"
      ? ((checkpoint.cursor as { value?: string | null }).value ?? null)
      : null;
  let inserted = run.insertedCount;
  let updated = run.updatedCount;
  let unchanged = run.unchangedCount;
  let rejected = run.rejectedCount;
  let retryCount = run.retryCount;
  let recordsCommitted = checkpoint?.recordsCommitted ?? 0;
  let pagesCommittedThisExecution = 0;

  try {
    for (;;) {
      const page = await withRetries(() => opts.adapter.fetchPage(cursor, pageSize), {
        maxRetries: cfg.SYNC_MAX_RETRIES,
        baseDelayMs: cfg.SYNC_RETRY_BASE_MS,
        maxDelayMs: cfg.SYNC_RETRY_MAX_MS,
        sleep: opts.sleep,
        random: opts.random,
        onRetry: async ({ attempt, delayMs, error }) => {
          retryCount += 1;
          await opts.db.insert(syncEvents).values({
            syncRunId: run!.id,
            eventType: "retry",
            message: error instanceof Error ? error.message : "retryable failure",
            details: { attempt, delayMs, retryCount },
          });
          await opts.db
            .update(syncRuns)
            .set({ retryCount, updatedAt: new Date() })
            .where(eq(syncRuns.id, run!.id));
        },
      });

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
      pagesCommittedThisExecution += 1;

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
          retryCount,
          updatedAt: new Date(),
        })
        .where(eq(syncRuns.id, run.id));

      await renewSourceLease(opts.db, {
        sourceId: source.id,
        owner: workerId,
        ttlSeconds: cfg.SYNC_LEASE_TTL_SECONDS,
        syncRunId: run.id,
      });

      await opts.db.insert(syncEvents).values({
        syncRunId: run.id,
        eventType: "page_committed",
        message: `Committed page ${page.pageNumber}`,
        details: { ...pageCounts, nextCursor: cursor, recordsCommitted },
      });

      if (
        opts.interruptAfterPages != null &&
        pagesCommittedThisExecution >= opts.interruptAfterPages
      ) {
        throw new Error("Simulated interruption after committed page");
      }

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
        retryCount,
        updatedAt: new Date(),
      })
      .where(eq(syncRuns.id, run.id));

    await opts.db.insert(syncEvents).values({
      syncRunId: run.id,
      eventType: "run_completed",
      message: "Sync completed",
      details: { inserted, updated, unchanged, rejected, durationMs, retryCount },
    });

    await releaseSourceLease(opts.db, { sourceId: source.id, owner: workerId });

    return {
      syncRunId: run.id,
      sourceId: source.id,
      status: "completed",
      failureReason: null,
      failureCategory: null,
      inserted,
      updated,
      unchanged,
      rejected,
      retryCount,
      durationMs,
      recordsPerSecond,
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    const reason = error instanceof Error ? error.message : String(error);
    const interrupted = reason.includes("Simulated interruption");
    const permanent =
      error && typeof error === "object" && "retryable" in error
        ? (error as { retryable?: boolean }).retryable === false
        : false;

    const failureCategory = interrupted
      ? "interrupted"
      : permanent
        ? "permanent_source_error"
        : retryCount >= cfg.SYNC_MAX_RETRIES
          ? "retry_exhausted"
          : "source_error";

    await opts.db
      .update(syncRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        durationMs,
        failureCategory,
        failureReason: reason,
        insertedCount: inserted,
        updatedCount: updated,
        unchangedCount: unchanged,
        rejectedCount: rejected,
        retryCount,
        updatedAt: new Date(),
      })
      .where(eq(syncRuns.id, run.id));

    await opts.db.insert(syncEvents).values({
      syncRunId: run.id,
      eventType: "run_failed",
      message: reason,
      details: { error: reason, failureCategory, retryCount },
    });

    // Keep lease released so another worker can recover/resume; checkpoint remains.
    await releaseSourceLease(opts.db, { sourceId: source.id, owner: workerId });

    return {
      syncRunId: run.id,
      sourceId: source.id,
      status: "failed",
      failureReason: reason,
      failureCategory,
      inserted,
      updated,
      unchanged,
      rejected,
      retryCount,
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
