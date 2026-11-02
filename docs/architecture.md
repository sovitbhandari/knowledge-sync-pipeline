# Architecture

Independent ETL service that extracts business-location records from external sources,
validates and normalizes them, and upserts into a canonical PostgreSQL store.

This project is not affiliated with any commercial listing platform.

## High-level components

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│ Mock REST / │────▶│ Sync Worker      │────▶│ PostgreSQL   │
│ CSV Upload  │     │ (Fastify host)   │     │ canonical DB │
└─────────────┘     └────────┬─────────┘     └──────────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ React Dashboard  │  (Phase 4)
                    └──────────────────┘
```

Phase 1 delivers the API host, PostgreSQL schema/migrations, and health probes.
Ingestion, retries, and the dashboard are implemented in later phases.

## PostgreSQL table ownership and lifecycle

| Table | Owner | Purpose | Lifecycle / retention |
| --- | --- | --- | --- |
| `data_sources` | Ops / seed | Registered adapters and config | Long-lived; soft-deactivate via `is_active` |
| `source_records` | Sync worker | Raw source payloads for debugging | Retain ~90 days; purge by `ingested_at` |
| `locations` | Sync worker | Canonical normalized locations | Indefinite; unique on `(source_id, external_id)` |
| `sync_runs` | Sync worker | Execution audit + counters + lease | Retain ~180 days |
| `sync_checkpoints` | Sync worker | Resume cursors per run | Cascades with `sync_runs`; one row per run |
| `rejected_records` | Sync worker | Validation failures with reasons | Retain ~90 days |
| `sync_events` | Sync worker | Structured run timeline | Retain ~180 days |

## Indexes (query-driven)

- Locations list/search: `name`, `(city, state)`, `category`
- Idempotent upsert lookup: unique `(source_id, external_id)`
- Sync history: `(source_id, created_at)`, `status`, `correlation_id`
- Checkpoint resume: unique `sync_run_id`
- Rejected/event drill-down: `sync_run_id`

## Data retention guidance

Raw `source_records`, `rejected_records`, and older `sync_runs` / `sync_events` should be
purged on a schedule in production. Phase 1 does not ship an automated purger; retention
windows above are the intended policy for later implementation.
