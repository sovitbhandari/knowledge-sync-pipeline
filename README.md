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
| Full verification / benchmarks (Phase 5) | Complete |

### Implemented features

- npm workspaces: `@ksp/api`, `@ksp/web`, `@ksp/shared`
- Fastify + Drizzle + PostgreSQL ETL/sync service
- Mock REST + CSV adapters, Zod canonicalization, idempotent upserts
- Retries, leases, checkpoints, terminal failure states
- Management REST API and React admin dashboard
- Vitest integration tests, Playwright UI coverage, GitHub Actions CI
- Repeatable local benchmarks with recorded measurements

### Verified behaviors

Executed locally on this machine:

- `npm run typecheck`, `npm run lint`, `npm run test` (22 automated tests)
- `npm run test:e2e -w @ksp/web` (dashboard shows persisted sync results)
- Required cases 1–11 covered
- Migrations apply against Docker Compose Postgres 16

### Experimental benchmarks

See [docs/benchmarks.md](docs/benchmarks.md). Example local cold-import throughput on
Apple M5 Pro / Postgres 16 / page size 200:

- 1,000 records ≈ 1,271 records/s
- 10,000 records ≈ 1,501 records/s
- 50,000 records ≈ 1,512 records/s

These numbers are not production performance or scalability claims.

### Known limitations

- `POST /api/syncs` awaits completion (fine for demo-scale imports)
- Management API/dashboard have no authentication
- Retention purge jobs are documented but not automated
- Optional commercial listing destination adapters are intentionally absent
- If host port 5432 is busy, set `POSTGRES_PORT` / `DATABASE_URL` (local `.env` uses `5433`)

## Quick start

```bash
cp .env.example .env
npm install
npm run db:up
docker compose ps
npm run db:migrate
npm run typecheck
npm run test
npm run dev:api
```

Another terminal:

```bash
npm run dev:web
```

Open `http://127.0.0.1:5173`.

```bash
npm run test:e2e
npm run bench -- 1000,10000,50000 200
```

## Documentation

- [Architecture](docs/architecture.md)
- [Data flow](docs/data-flow.md)
- [Failure and recovery](docs/failure-recovery.md)
- [API](docs/api.md)
- [Security notes](docs/security.md)
- [Benchmarks](docs/benchmarks.md)
