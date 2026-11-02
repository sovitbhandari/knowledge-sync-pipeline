# Benchmarks

## Method

- Script: `npm run bench -- 1000,10000,50000 200`
- Adapter: in-process mock REST fixture (same process as runner)
- Database: PostgreSQL from local Docker Compose / `DATABASE_URL`
- Workload: cold full import after truncating sync/location tables
- Metric: wall-clock `runSync` duration; `records/s = processed / durationMs * 1000`

These are experimental local measurements only. They are not production capacity,
SLA, or business-impact claims.

## Measured results (2026-11-02)

Hardware:

- Platform: darwin arm64
- CPU: Apple M5 Pro (15 cores reported)
- Memory: 24 GB
- Node: v22.16.0
- Page size: 200

| Records | Duration | Throughput | Inserted |
| --- | --- | --- | --- |
| 1,000 | 787 ms | 1,271 records/s | 1,000 |
| 10,000 | 6,661 ms | 1,501 records/s | 10,000 |
| 50,000 | 33,061 ms | 1,512 records/s | 50,000 |

Raw JSON: `benchmarks/results/bench-1793648785956.json`
