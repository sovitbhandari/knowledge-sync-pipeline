# API documentation

Base URL (local): `http://127.0.0.1:3001`

All JSON request bodies use `Content-Type: application/json`.
List endpoints are paginated with `page` and `pageSize`.

## Health

### `GET /health/live`

Liveness probe. Does not check the database.

### `GET /health/ready`

Readiness probe. Returns `503` when PostgreSQL is unreachable.

## Sources

### `GET /api/sources`

Lists registered data sources (`mock-rest`, `csv-upload`).

## Syncs

### `POST /api/syncs`

Start a synchronization.

```json
{
  "sourceKey": "mock-rest",
  "mode": "full",
  "pageSize": 25,
  "resumeRunId": null,
  "csvText": null
}
```

- `sourceKey=csv-upload` requires `csvText`
- `201` completed successfully
- `409` lease conflict
- `422` terminal sync failure
- `400` validation error

### `GET /api/syncs`

Paginated sync history. Optional `sourceKey` filter.

### `GET /api/syncs/:id`

Sync run detail including rejected records and recent events.

### `GET /api/syncs/overview/latest`

Dashboard overview: latest run + aggregate counters.

## Locations

### `GET /api/locations`

Query synchronized locations.

Query params: `page`, `pageSize`, `q`, `city`, `state`, `category`, `sourceKey`.

### `GET /api/locations/:id`

Location detail.

## Mock source (development)

### `GET /mock-source/locations?cursor=&limit=`

Deterministic paginated fixture API used by the mock REST adapter.
