import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Table ownership and lifecycle (Phase 1 schema; sync logic lands in later phases).
 *
 * data_sources      — owned by ops/config; seed + admin managed; long-lived.
 * source_records    — owned by sync worker; raw payload archive; retain ~90 days.
 * locations         — owned by sync worker; canonical store; indefinite.
 * sync_runs         — owned by sync worker; run audit; retain ~180 days.
 * sync_checkpoints  — owned by sync worker; resume cursors; deleted with completed runs or retained for audit.
 * rejected_records  — owned by sync worker; validation failures; retain ~90 days.
 * sync_events       — owned by sync worker; structured timeline; retain ~180 days.
 */

export const syncModeEnum = pgEnum("sync_mode", ["full", "incremental"]);

export const syncRunStatusEnum = pgEnum("sync_run_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const syncEventTypeEnum = pgEnum("sync_event_type", [
  "run_started",
  "page_fetched",
  "page_committed",
  "retry",
  "lease_acquired",
  "lease_renewed",
  "lease_expired",
  "run_completed",
  "run_failed",
  "checkpoint_saved",
]);

export const dataSources = pgTable(
  "data_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: varchar("key", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    adapterType: varchar("adapter_type", { length: 32 }).notNull(),
    config: jsonb("config").notNull().default({}),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("data_sources_key_uidx").on(table.key)],
);

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "restrict" }),
    externalId: varchar("external_id", { length: 128 }).notNull(),
    name: varchar("name", { length: 512 }).notNull(),
    addressLine1: varchar("address_line1", { length: 512 }).notNull(),
    addressLine2: varchar("address_line2", { length: 512 }),
    city: varchar("city", { length: 255 }).notNull(),
    state: varchar("state", { length: 64 }).notNull(),
    postalCode: varchar("postal_code", { length: 32 }).notNull(),
    country: varchar("country", { length: 2 }).notNull(),
    phoneE164: varchar("phone_e164", { length: 32 }),
    websiteUrl: text("website_url"),
    category: varchar("category", { length: 128 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("locations_source_external_uidx").on(table.sourceId, table.externalId),
    index("locations_name_idx").on(table.name),
    index("locations_city_state_idx").on(table.city, table.state),
    index("locations_category_idx").on(table.category),
    index("locations_content_hash_idx").on(table.contentHash),
  ],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "restrict" }),
    mode: syncModeEnum("mode").notNull().default("full"),
    status: syncRunStatusEnum("status").notNull().default("pending"),
    leaseOwner: varchar("lease_owner", { length: 128 }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    insertedCount: integer("inserted_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    unchangedCount: integer("unchanged_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    retryCount: integer("retry_count").notNull().default(0),
    recordsPerSecond: integer("records_per_second"),
    durationMs: bigint("duration_ms", { mode: "number" }),
    failureCategory: varchar("failure_category", { length: 64 }),
    failureReason: text("failure_reason"),
    correlationId: varchar("correlation_id", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sync_runs_source_created_idx").on(table.sourceId, table.createdAt),
    index("sync_runs_status_idx").on(table.status),
    index("sync_runs_correlation_idx").on(table.correlationId),
  ],
);

export const syncCheckpoints = pgTable(
  "sync_checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => syncRuns.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "restrict" }),
    cursor: jsonb("cursor").notNull().default({}),
    pageNumber: integer("page_number").notNull().default(0),
    recordsCommitted: integer("records_committed").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sync_checkpoints_run_uidx").on(table.syncRunId),
    index("sync_checkpoints_source_idx").on(table.sourceId),
  ],
);

export const sourceRecords = pgTable(
  "source_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "restrict" }),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => syncRuns.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 128 }).notNull(),
    rawPayload: jsonb("raw_payload").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("source_records_source_external_idx").on(table.sourceId, table.externalId),
    index("source_records_sync_run_idx").on(table.syncRunId),
    index("source_records_ingested_idx").on(table.ingestedAt),
  ],
);

export const rejectedRecords = pgTable(
  "rejected_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "restrict" }),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => syncRuns.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 128 }),
    rawPayload: jsonb("raw_payload").notNull(),
    reason: text("reason").notNull(),
    validationErrors: jsonb("validation_errors")
      .notNull()
      .default(sql`'[]'::jsonb`),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("rejected_records_sync_run_idx").on(table.syncRunId),
    index("rejected_records_source_idx").on(table.sourceId),
  ],
);

export const syncEvents = pgTable(
  "sync_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => syncRuns.id, { onDelete: "cascade" }),
    eventType: syncEventTypeEnum("event_type").notNull(),
    message: text("message").notNull(),
    details: jsonb("details").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sync_events_run_created_idx").on(table.syncRunId, table.createdAt),
    index("sync_events_type_idx").on(table.eventType),
  ],
);

export type DataSource = typeof dataSources.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;
export type SyncCheckpoint = typeof syncCheckpoints.$inferSelect;
export type SourceRecord = typeof sourceRecords.$inferSelect;
export type RejectedRecord = typeof rejectedRecords.$inferSelect;
export type SyncEvent = typeof syncEvents.$inferSelect;
