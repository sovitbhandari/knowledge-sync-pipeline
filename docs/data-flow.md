# Data flow

```
┌────────────────┐   HTTP pages    ┌─────────────────┐
│ Mock REST API  │ ───────────────▶│ MockRestAdapter │──┐
│ /mock-source   │                 └─────────────────┘  │
└────────────────┘                                      │
                                                        ▼
┌────────────────┐   row stream    ┌─────────────────┐  ┌──────────────┐
│ CSV upload     │ ───────────────▶│ CsvAdapter      │─▶│ normalize +  │
│ (text/file)    │                 └─────────────────┘  │ Zod validate │
└────────────────┘                                      └──────┬───────┘
                                                               │
                                    ┌──────────────────────────┼──────────────────────────┐
                                    ▼                          ▼                          ▼
                            source_records              locations upsert           rejected_records
                            (raw payload)               (canonical)                (auditable reason)
                                    │                          │
                                    └──────────┬───────────────┘
                                               ▼
                                         sync_runs +
                                         sync_checkpoints +
                                         sync_events
```

## Idempotency

Canonical uniqueness is `(source_id, external_id)`. Each successful normalize computes a
SHA-256 `content_hash` over canonical fields. On import:

- missing key → insert
- same hash → unchanged
- different hash → update

Raw payloads are stored separately in `source_records` for debugging and are not used as
the system of record.

## Pagination notes (full sync)

The mock REST source orders by `external_id` ascending and uses an offset cursor.
If source records change while pagination is in progress:

- Updates to already-committed pages are not revisited until a later sync.
- Inserts with IDs that sort before the current cursor may be missed until a later full sync.
- This is why Phase 3 adds checkpoints and documents resume semantics explicitly.

Timestamp cursors are not assumed safe unless a source guarantees monotonic, durable ordering.
