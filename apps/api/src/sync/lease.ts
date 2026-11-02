import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { dataSources, syncRuns } from "../db/schema.js";

export class LeaseConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaseConflictError";
  }
}

export type Lease = {
  sourceId: string;
  owner: string;
  expiresAt: Date;
  syncRunId: string | null;
};

/**
 * Acquire an exclusive lease on a data source.
 * Succeeds when no lease exists or the existing lease is expired (recovery).
 */
export async function acquireSourceLease(
  db: Database,
  opts: {
    sourceId: string;
    owner: string;
    ttlSeconds: number;
    syncRunId?: string | null;
  },
): Promise<Lease> {
  const expiresAt = new Date(Date.now() + opts.ttlSeconds * 1000);

  const updated = await db
    .update(dataSources)
    .set({
      leaseOwner: opts.owner,
      leaseExpiresAt: expiresAt,
      activeSyncRunId: opts.syncRunId ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(dataSources.id, opts.sourceId),
        or(
          isNull(dataSources.leaseExpiresAt),
          lt(dataSources.leaseExpiresAt, sql`now()`),
          eq(dataSources.leaseOwner, opts.owner),
        ),
      ),
    )
    .returning({
      id: dataSources.id,
      leaseOwner: dataSources.leaseOwner,
      leaseExpiresAt: dataSources.leaseExpiresAt,
      activeSyncRunId: dataSources.activeSyncRunId,
    });

  const row = updated[0];
  if (!row || !row.leaseOwner || !row.leaseExpiresAt) {
    const current = await db.query.dataSources.findFirst({
      where: eq(dataSources.id, opts.sourceId),
    });
    throw new LeaseConflictError(
      `Source lease held by '${current?.leaseOwner ?? "unknown"}' until ${current?.leaseExpiresAt?.toISOString() ?? "unknown"}`,
    );
  }

  return {
    sourceId: row.id,
    owner: row.leaseOwner,
    expiresAt: row.leaseExpiresAt,
    syncRunId: row.activeSyncRunId,
  };
}

export async function renewSourceLease(
  db: Database,
  opts: { sourceId: string; owner: string; ttlSeconds: number; syncRunId: string },
): Promise<Lease> {
  const expiresAt = new Date(Date.now() + opts.ttlSeconds * 1000);
  const updated = await db
    .update(dataSources)
    .set({
      leaseExpiresAt: expiresAt,
      activeSyncRunId: opts.syncRunId,
      updatedAt: new Date(),
    })
    .where(and(eq(dataSources.id, opts.sourceId), eq(dataSources.leaseOwner, opts.owner)))
    .returning({
      id: dataSources.id,
      leaseOwner: dataSources.leaseOwner,
      leaseExpiresAt: dataSources.leaseExpiresAt,
      activeSyncRunId: dataSources.activeSyncRunId,
    });

  const row = updated[0];
  if (!row?.leaseOwner || !row.leaseExpiresAt) {
    throw new LeaseConflictError(`Failed to renew lease for owner '${opts.owner}'`);
  }

  await db
    .update(syncRuns)
    .set({
      leaseOwner: opts.owner,
      leaseExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(syncRuns.id, opts.syncRunId));

  return {
    sourceId: row.id,
    owner: row.leaseOwner,
    expiresAt: row.leaseExpiresAt,
    syncRunId: row.activeSyncRunId,
  };
}

export async function releaseSourceLease(
  db: Database,
  opts: { sourceId: string; owner: string },
): Promise<void> {
  await db
    .update(dataSources)
    .set({
      leaseOwner: null,
      leaseExpiresAt: null,
      activeSyncRunId: null,
      updatedAt: new Date(),
    })
    .where(and(eq(dataSources.id, opts.sourceId), eq(dataSources.leaseOwner, opts.owner)));
}
