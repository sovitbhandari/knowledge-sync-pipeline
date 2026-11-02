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
| Retries, leases, checkpoints (Phase 3) | Complete |
| Management API + React dashboard (Phase 4) | Complete |
| Full verification / benchmarks (Phase 5) | In progress |

### Implemented

- npm workspaces monorepo (`apps/api`, `apps/web`, `packages/shared`)
- TypeScript, ESLint, Prettier, Docker Compose PostgreSQL 16
- Drizzle schema/migrations for core sync tables
- Fastify management API + embedded `/mock-source` fixtures
- Canonical Zod validation + normalization (`@ksp/shared`)
- Mock REST + CSV adapters sharing the same validation pipeline
- Idempotent location upserts with content hashes and rejection audit rows
- Bounded retries with jitter, HTTP 429 `Retry-After` support
- Database-backed source leases with expired-lease recovery
- Checkpoint resume after interruption; terminal failed-job states
- React admin dashboard (TanStack Query) against live API responses
- Playwright coverage for persisted sync results in the UI

### Verified (executed locally)

- `typecheck`, `lint`, API/shared Vitest suites (22 tests)
- Playwright: dashboard displays persisted sync results after Run Sync
- Required behavioral cases 1–11 covered by automated tests

### Experimental / not claimed

- Performance benchmarks land in Phase 5
- No production scalability claims

### Known limitations

- Sync `POST /api/syncs` currently awaits completion (suitable for demo-scale datasets)
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

In another shell:

```bash
npm run dev:web
```

Open `http://127.0.0.1:5173`.

Optional CLI sync (API must be running):

```bash
npm run sync:mock -w @ksp/api -- 25
```

E2E:

```bash
npm run test:e2e -w @ksp/web
```

## Workspace layout

```
apps/api          Fastify API, adapters, sync runner, migrations
apps/web          React admin dashboard + Playwright e2e
packages/shared   Canonical Zod schemas + normalization
docs/             Architecture, API, data-flow, failure/recovery
```

## Documentation

- [Architecture](docs/architecture.md)
- [Data flow](docs/data-flow.md)
- [Failure and recovery](docs/failure-recovery.md)
- [API](docs/api.md)
