ALTER TABLE "data_sources" ADD COLUMN "lease_owner" varchar(128);--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "active_sync_run_id" uuid;--> statement-breakpoint
CREATE INDEX "data_sources_lease_expires_idx" ON "data_sources" USING btree ("lease_expires_at");