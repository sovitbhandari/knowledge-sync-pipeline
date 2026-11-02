import {
  LocationValidationError,
  normalizeLocation,
  type CanonicalLocation,
  type RawLocation,
  type ValidationIssue,
} from "@ksp/shared";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import {
  locations,
  rejectedRecords,
  sourceRecords,
} from "../db/schema.js";
import type { SyncCounts } from "./types.js";

export type PersistPageInput = {
  db: Database;
  sourceId: string;
  syncRunId: string;
  records: RawLocation[];
};

export type PersistPageResult = SyncCounts;

export async function persistPage(input: PersistPageInput): Promise<PersistPageResult> {
  const counts: SyncCounts = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
  };

  await input.db.transaction(async (tx) => {
    for (const raw of input.records) {
      let canonical: CanonicalLocation;
      try {
        canonical = normalizeLocation(raw);
      } catch (error) {
        counts.rejected += 1;
        const issues: ValidationIssue[] =
          error instanceof LocationValidationError
            ? error.issues
            : [{ path: "(root)", code: "unknown", message: String(error) }];
        await tx.insert(rejectedRecords).values({
          sourceId: input.sourceId,
          syncRunId: input.syncRunId,
          externalId: typeof raw.external_id === "string" ? raw.external_id : null,
          rawPayload: raw,
          reason: error instanceof Error ? error.message : "Validation failed",
          validationErrors: issues,
        });
        continue;
      }

      await tx.insert(sourceRecords).values({
        sourceId: input.sourceId,
        syncRunId: input.syncRunId,
        externalId: canonical.externalId,
        rawPayload: raw,
        contentHash: canonical.contentHash,
        sourceUpdatedAt: canonical.sourceUpdatedAt,
      });

      const existing = await tx.query.locations.findFirst({
        where: and(
          eq(locations.sourceId, input.sourceId),
          eq(locations.externalId, canonical.externalId),
        ),
      });

      if (!existing) {
        await tx.insert(locations).values({
          sourceId: input.sourceId,
          externalId: canonical.externalId,
          name: canonical.name,
          addressLine1: canonical.addressLine1,
          addressLine2: canonical.addressLine2,
          city: canonical.city,
          state: canonical.state,
          postalCode: canonical.postalCode,
          country: canonical.country,
          phoneE164: canonical.phoneE164,
          websiteUrl: canonical.websiteUrl,
          category: canonical.category,
          contentHash: canonical.contentHash,
          sourceUpdatedAt: canonical.sourceUpdatedAt,
          syncedAt: new Date(),
        });
        counts.inserted += 1;
        continue;
      }

      if (existing.contentHash === canonical.contentHash) {
        counts.unchanged += 1;
        continue;
      }

      await tx
        .update(locations)
        .set({
          name: canonical.name,
          addressLine1: canonical.addressLine1,
          addressLine2: canonical.addressLine2,
          city: canonical.city,
          state: canonical.state,
          postalCode: canonical.postalCode,
          country: canonical.country,
          phoneE164: canonical.phoneE164,
          websiteUrl: canonical.websiteUrl,
          category: canonical.category,
          contentHash: canonical.contentHash,
          sourceUpdatedAt: canonical.sourceUpdatedAt,
          syncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(locations.id, existing.id));
      counts.updated += 1;
    }
  });

  return counts;
}
