# Knowledge Sync Pipeline

Integration service that extracts business-location records from external sources,
transforms and validates them, and synchronizes them into a canonical PostgreSQL database.

**Not affiliated with Yext or any commercial listing platform.** Inspired by common
enterprise integration problems for portfolio demonstration.

## Status

| Area | Status |
| --- | --- |
| Repository foundation (Phase 1) | Complete |
| ETL adapters / normalization (Phase 2) | Not started |
| Retries, leases, checkpoints (Phase 3) | Not started |
| Management API + React dashboard (Phase 4) | Not started |
| Full verification / benchmarks (Phase 5) | Not started |

### Implemented

- npm workspaces monorepo (`apps/api`, `packages/shared`)
- TypeScript, ESLint, Prettier
- Docker Compose PostgreSQL 16
- Drizzle ORM schema + SQL migrations for core tables
- Fastify API with `/health/live` and `/health/ready`
- Environment validation via Zod
- Unit/integration smoke tests for config and health probes

### Verified (executed locally)

- `npm install`
- `docker compose up -d postgres` (Postgres 16 healthy on host port from `.env`)
- `npm run db:migrate` — created `data_sources`, `locations`, `source_records`, `sync_runs`, `sync_checkpoints`, `rejected_records`, `sync_events`
- `npm run typecheck`, `npm run lint`, `npm run test` (4 tests passed)
- `npm run build` for `@ksp/api` and `@ksp/shared`
- `GET /health/live` → `200 { status: "ok" }`
- `GET /health/ready` → `200 { status: "ready", database: "ok" }`

### Experimental / not claimed

- No performance benchmarks yet
- No production scalability claims

### Known limitations

- No ingestion, sync worker, or dashboard yet
- No automated retention purger
- Shared package is a workspace stub until Phase 2 schemas land
- If host port 5432 is occupied, set `POSTGRES_PORT` / `DATABASE_URL` (this machine uses `5433` in `.env`)

## Stack

- Backend: Node.js, TypeScript, Fastify, Pino
- Database: PostgreSQL 16, Drizzle ORM
- Validation: Zod
- Frontend (later): React, Vite, TanStack Query
- Tests: Vitest (Playwright later)
- Infra: Docker Compose (GitHub Actions later)

## Quick start (Phase 1)

```bash
cp .env.example .env
# Start Docker Desktop if needed, then:
npm install
npm run db:up
docker compose ps   # wait until healthy
npm run db:migrate
npm run typecheck
npm run test
npm run dev:api
```

Health checks:

```bash
curl -s http://localhost:3001/health/live
curl -s http://localhost:3001/health/ready
```

## Workspace layout

```
apps/api          Fastify API, Drizzle schema, migrations, (future) sync worker
packages/shared   Shared Zod schemas / types (expanded in Phase 2)
docs/             Architecture and design notes
```

## Documentation

- [Architecture](docs/architecture.md) — components, table ownership, retention
- API docs, failure/recovery design, and benchmarks arrive in later phases
