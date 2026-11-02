# Failure and recovery design

## Failure classes

| Class | Examples | Behavior |
| --- | --- | --- |
| Retryable transient | HTTP timeouts, HTTP 5xx, HTTP 429 | Bounded exponential backoff with full jitter; honor valid `Retry-After` |
| Permanent source | Malformed JSON, HTTP 4xx (non-429) | Fail immediately; no retry loop |
| Validation | Missing address, bad phone/country | Reject record; continue page; audit in `rejected_records` |
| Lease conflict | Another worker holds unexpired lease | Fail run attempt with `lease_conflict` |
| Interruption | Worker crash after page commit | Run marked `failed`/`interrupted`; checkpoint retained for resume |

## Retries

- Max attempts: `SYNC_MAX_RETRIES` (default 5)
- Base/max delay: `SYNC_RETRY_BASE_MS` / `SYNC_RETRY_MAX_MS`
- Each retry increments `sync_runs.retry_count` and appends a `sync_events` row of type `retry`
- Exhaustion yields terminal `failed` with `failure_category=retry_exhausted`

## Leases

Exclusive coordination is stored on `data_sources`:

- `lease_owner`, `lease_expires_at`, `active_sync_run_id`

Acquire succeeds when the lease is absent, owned by the same worker, or expired.
Expired leases are recoverable by a new worker without manual intervention.
Lease TTL is renewed after each committed page.

## Checkpoints and resume

After each successfully committed page the runner updates `sync_checkpoints`:

- opaque cursor (`{ value }`)
- page number
- records committed

Resume loads the run + checkpoint and continues from the stored cursor.
Committed pages are not re-fetched; already-written locations remain idempotent via content hash if overlap occurs.

## Pagination vs source mutations

The mock REST source uses deterministic `external_id` ordering with an offset cursor.
If records change while a paginated sync is in flight:

- already-committed pages are not revisited until a later sync
- inserts that sort before the current cursor can be missed until a later full sync

Timestamp watermarks are not treated as safe cursors unless a source guarantees monotonic durable order.
