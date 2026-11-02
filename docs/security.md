# Security review notes

Scope: local/demo knowledge-sync-pipeline service. Not a production hardening audit.

## Findings addressed in this codebase

1. **No hardcoded secrets** — credentials come from environment variables; `.env` is gitignored; `.env.example` has placeholders only.
2. **Input validation** — request bodies/queries validated with Zod; invalid input returns `400`.
3. **SQL injection resistance** — queries use Drizzle parameterized builders rather than string-concatenated SQL.
4. **Sync coordination** — database leases reduce accidental concurrent writes for the same source.
5. **Raw vs canonical separation** — raw payloads are retained for audit without becoming the system of record.
6. **Yext / third-party APIs** — no live third-party credentials or outbound commercial listing API calls are present.

## Residual risks / known limitations

1. **No authentication/authorization** on the management API or dashboard (local admin tool assumption).
2. **CORS is open** (`origin: true`) for local development convenience.
3. **CSV upload accepts arbitrary text** in `POST /api/syncs`; size limits and auth would be required before internet exposure.
4. **Mock source is mounted on the same process** as the management API; isolate in non-demo deployments.
5. **Dependency vulnerabilities** may exist in the lockfile; run `npm audit` regularly and upgrade intentionally.
6. **Retention** for `source_records` / `rejected_records` / sync history is documented but not automated.

## Recommended before any shared deployment

- Add authn/authz (at least network ACL + basic auth or OIDC)
- Restrict CORS
- Cap upload/body sizes and rate-limit sync creation
- Separate mock fixtures from the management plane
- Enable TLS termination and secret management
- Add automated retention jobs
