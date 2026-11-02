CREATE TYPE "public"."sync_event_type" AS ENUM('run_started', 'page_fetched', 'page_committed', 'retry', 'lease_acquired', 'lease_renewed', 'lease_expired', 'run_completed', 'run_failed', 'checkpoint_saved');--> statement-breakpoint
CREATE TYPE "public"."sync_mode" AS ENUM('full', 'incremental');--> statement-breakpoint
CREATE TYPE "public"."sync_run_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"adapter_type" varchar(32) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" varchar(128) NOT NULL,
	"name" varchar(512) NOT NULL,
	"address_line1" varchar(512) NOT NULL,
	"address_line2" varchar(512),
	"city" varchar(255) NOT NULL,
	"state" varchar(64) NOT NULL,
	"postal_code" varchar(32) NOT NULL,
	"country" varchar(2) NOT NULL,
	"phone_e164" varchar(32),
	"website_url" text,
	"category" varchar(128) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"source_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rejected_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"external_id" varchar(128),
	"raw_payload" jsonb NOT NULL,
	"reason" text NOT NULL,
	"validation_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rejected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"external_id" varchar(128) NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"source_updated_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"page_number" integer DEFAULT 0 NOT NULL,
	"records_committed" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"event_type" "sync_event_type" NOT NULL,
	"message" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"mode" "sync_mode" DEFAULT 'full' NOT NULL,
	"status" "sync_run_status" DEFAULT 'pending' NOT NULL,
	"lease_owner" varchar(128),
	"lease_expires_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"inserted_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"unchanged_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"records_per_second" integer,
	"duration_ms" bigint,
	"failure_category" varchar(64),
	"failure_reason" text,
	"correlation_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejected_records" ADD CONSTRAINT "rejected_records_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejected_records" ADD CONSTRAINT "rejected_records_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_checkpoints" ADD CONSTRAINT "sync_checkpoints_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_checkpoints" ADD CONSTRAINT "sync_checkpoints_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "data_sources_key_uidx" ON "data_sources" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_source_external_uidx" ON "locations" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "locations_name_idx" ON "locations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "locations_city_state_idx" ON "locations" USING btree ("city","state");--> statement-breakpoint
CREATE INDEX "locations_category_idx" ON "locations" USING btree ("category");--> statement-breakpoint
CREATE INDEX "locations_content_hash_idx" ON "locations" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "rejected_records_sync_run_idx" ON "rejected_records" USING btree ("sync_run_id");--> statement-breakpoint
CREATE INDEX "rejected_records_source_idx" ON "rejected_records" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "source_records_source_external_idx" ON "source_records" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "source_records_sync_run_idx" ON "source_records" USING btree ("sync_run_id");--> statement-breakpoint
CREATE INDEX "source_records_ingested_idx" ON "source_records" USING btree ("ingested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_checkpoints_run_uidx" ON "sync_checkpoints" USING btree ("sync_run_id");--> statement-breakpoint
CREATE INDEX "sync_checkpoints_source_idx" ON "sync_checkpoints" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "sync_events_run_created_idx" ON "sync_events" USING btree ("sync_run_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_events_type_idx" ON "sync_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "sync_runs_source_created_idx" ON "sync_runs" USING btree ("source_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_runs_status_idx" ON "sync_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_runs_correlation_idx" ON "sync_runs" USING btree ("correlation_id");