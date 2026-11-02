# Knowledge Sync Pipeline

Integration service that extracts business-location records from external sources,
transforms and validates them, and synchronizes them into a canonical PostgreSQL database.

**Not affiliated with Yext or any commercial listing platform.** Inspired by common
enterprise integration problems for portfolio demonstration.

## Status

| Area | Status |
| --- | --- |
| Repository foundation (Phase 1) | Complete |
| ETL adapters / normalization (Phase 2) | Complete |
| Retries, leases, checkpoints (Phase 3) | Not started |
| Management API + React dashboard (Phase 4) | Not started |
| Full verification / benchmarks (Phase 5) | Not started |

### Implemented

- npm workspaces monorepo (`apps/api`, `packages/shared`)
- TypeScript, ESLint, Prettier, Docker Compose PostgreSQL 16
- Drizzle schema/migrations for core sync tables
- Fastify API with `/health/*` and embedded `/mock-source` REST fixtures
- Canonical Zod validation + normalization (`@ksp/shared`)
- Mock REST + CSV adapters sharing the same validation pipeline
- Idempotent location upserts with content hashes and rejection audit rows
- Sync runner with per-page transactions and checkpoint/event records

### Verified (executed locally)

- Phase 1 health/migrate/typecheck/lint checks
- `@ksp/shared` normalize unit tests (3)
- API tests (9): health, config, and sync integration cases:
  1. first import inserts all valid records
  2. repeated import creates no duplicates
  3. changed source record updates only that canonical row
  4. malformed records rejected with auditable reason
  11. CSV and REST produce equivalent content hashes

### Experimental / not claimed

- No performance benchmarks yet
- No production scalability claims

### Known limitations

- No bounded retry/429 handling, leases, or resumable interruption recovery yet (Phase 3)
- No public management API or React dashboard yet (Phase 4)
- No automated retention purger
- If host port 5432 is occupied, set `POSTGRES_PORT` / `DATABASE_URL` (this machine uses `5433` in `.env`)

## Quick start

```bash
cp .env.example .env
npm install
npm run db:up
docker compose ps   # wait until healthy
npm run db:migrate
npm run typecheck
npm run test
npm run dev:api
```

In another shell, with the API running (mock source mounted):

```bash
npm run sync:mock -w @ksp/api -- 25
```

Health:

```bash
curl -s http://localhost:3001/health/live
curl -s http://localhost:3001/health/ready
curl -s 'http://localhost:3001/mock-source/locations?limit=2'
```

## Workspace layout

```
apps/api          Fastify API, adapters, sync runner, migrations
packages/shared   Canonical Zod schemas + normalization
docs/             Architecture and data-flow notes
```

## Documentation

- [Architecture](docs/architecture.md)
- [Data flow](docs/data-flow.md)
