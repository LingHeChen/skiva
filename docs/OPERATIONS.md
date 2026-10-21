# Deployment and operations

English · [简体中文](OPERATIONS.zh-CN.md)

## Installation

1. Use Node 24, Git and the Go 1.26.10 toolchain. `make deps` downloads locked dependencies.
2. Copy `.env.example` to `.env.local`, mode 0600, choose a unique administrator bootstrap password (14+ characters), database URL and Web origin. `SKIVA_ORG_ID` optionally selects the single deployment organization; keep it stable across upgrades.
3. `make db` starts the local PostgreSQL container. `make migrate-up` applies goose migrations. If using an alternate database, pass `DATABASE_URL=...`; `scripts/dev.sh` loads `.env.local` before calling Make.
4. `make dev` runs the Go API/worker and Next.js. `SKIVA_WEB_PORT` must agree with `SKIVA_WEB_ORIGIN`.
5. `docker compose -f deployments/compose.yaml --profile full up --build -d` is the packaged deployment path. Apply migrations before starting server, preserve Postgres and artifact volumes, and set credentials explicitly. The API refuses an absent/short bootstrap password.
6. Use `deployments/Caddyfile` as a TLS reverse-proxy template. `/distribution/*` goes directly to Go, not through Next.js. Restrict `/metrics` to the monitoring network. Set production mode and the exact external HTTPS Web origin.

Use separate databases for development, integration tests, and production; never reuse test fixtures as deployment data.

## OIDC and RBAC

Set `SKIVA_ENV=production`, `SKIVA_OIDC_ISSUER`, `SKIVA_OIDC_CLIENT_ID`, `SKIVA_OIDC_CLIENT_SECRET`, `SKIVA_WEB_ORIGIN`. Register `${SKIVA_WEB_ORIGIN}/api/v1/auth/oidc/callback` at the IdP. Enforce MFA and organization policies at the IdP. The Go backend verifies discovery issuer, signature, audience, expiry and nonce; Authorization Code uses PKCE S256. Local password login is rejected in production.

Pre-provision a member with the verified enterprise email, then assign roles. First OIDC login binds the issuer/subject to that pre-provisioned membership and clears the local password hash. Unprovisioned identities are denied. Subsequent logins use the bound subject. Sessions are 8 hours and explicit refresh rotates the session. Disable a member to revoke access through authorization checks.

## Git credentials and policy

- HTTPS secrets contain an HTTP Authorization value (`Bearer ...` or `Basic ...`). Save the secret in protected runtime environment/KMS injection, then create a reference to its environment variable name in Settings. URL-embedded passwords are rejected.
- SSH secrets contain a private key. The worker writes a short-lived 0600 key file, uses strict host checking, and removes the key after Git completes. Provide `SKIVA_SSH_KNOWN_HOSTS`. No administrator personal key is used.
- `SKIVA_GIT_ALLOWLIST` explicitly permits private hostnames. DNS is validated, then Git's HTTPS resolve or SSH HostName is pinned to the validated address. Redirects, file/ext protocols, hooks, submodules and source CI scripts are disabled.
- `SKIVA_GIT_CA_BUNDLE` adds the corporate Git CA. TLS verification is never disabled. Prefer IPv4 when both address families are returned; IPv6-only repositories remain supported.
- Static limits are configurable in Settings: file bytes, tree bytes, file count, blocking scripts and Markdown external links. `.skills-platform.yaml` can set root/trigger policy and stricter script/link checks. Unknown YAML keys (including arbitrary shell steps) fail validation.
- Git fetch runs with a deadline and bounded captured output. Production operators must additionally give the worker a bounded-volume filesystem and CPU/memory quotas: a malicious Git pack can consume resources before tree validation. The service never claims that static analysis proves a Skill safe.

Example repository configuration:

```yaml
version: 1
skills:
  root: skills
pipeline:
  trigger:
    branches: [main]
validate:
  blockScripts: true
  blockExternalLinks: false
```

## Publish and rollback

Select successful Skill Versions, preview the complete view and review warnings. Create a Snapshot, promote to canary, validate, then promote the **same** Snapshot to stable. A promotion locks the channel, checks expected generation, checks artifact integrity, and commits channel/history/audit/outbox together. Repeated identical Idempotency-Key returns its original channel result. Conflicts require refreshing generation, not blind retry.

Rollback requires a previous snapshot from that channel's history and a reason. It does not rebuild or edit objects. The backend rechecks target blobs. A deleted/disabled source repository does not remove historical snapshots.

Write requests with Idempotency-Key are serialized and cached for transactional creation. One-time credential responses are deliberately redacted in stored replay records; raw client credentials exist only in the first response. If that response is lost, rotate. The database stores credential hashes, never token plaintext.

## Worker and failures

One embedded worker per process polls the PostgreSQL lease queue. Job claiming uses `FOR UPDATE SKIP LOCKED`; repository advisory locks serialize bare Git mutation. A build has a 4-minute parent deadline and a 5-minute lease. Expired jobs can be reclaimed, with fixed commit/config/validator idempotency preventing duplicate versions. Ordinary failures retry up to three attempts with delay. Reconcile runs each minute; webhook events never automatically publish a channel.

For a failed sync, inspect repository sync jobs and pipeline diagnostics. Fix source metadata/references, credentials or network; retry. Do not modify live mount directories. If database/audit commit fails, the mutation rolls back. SSE failures are recovered by client polling.

## Monitoring

`/healthz` checks PostgreSQL; `/metrics` exports HTTP/content statuses, job backlog, stale clients, pipeline timing/failures, channel generations, publication conflicts and audit failures. Set `OTEL_EXPORTER_OTLP_ENDPOINT` for OTLP traces; request IDs appear in JSON logs and audit. Import `deployments/grafana-dashboard.json` and `prometheus-alerts.yaml`. Metrics are measured values, not an SLO guarantee. Protect metrics access at the reverse proxy/network.

## Backup and recovery

Stop API/worker writes and pause the demo Git source's writers before backup to obtain a consistent DB/CAS/Git recovery point. Use protected encrypted backup storage and define RPO/RTO for your environment.

```bash
SKIVA_DATABASE_URL='postgres://...' SKIVA_DATA_DIR=/srv/skiva \
SKIVA_BACKUP_DIR=/secure/backups ./scripts/backup.sh
```

Use a PostgreSQL client matching the server major version. For local Docker, `SKIVA_PG_CONTAINER=skiva-postgres` uses the container's matching pg_dump/pg_restore instead of an older host binary. This optional mode assumes the local `skiva` DB user.

Restore into a **new empty database** and a **nonexistent data directory**:

```bash
SKIVA_RESTORE_DATABASE_URL='postgres://.../new_database' \
SKIVA_RESTORE_DATA_DIR=/srv/skiva-restored \
./scripts/restore.sh /secure/backups/TIMESTAMP
```

The script verifies checksums, restores DB and data, then verifies every version→Blob digest and size. Only switch service configuration after this succeeds and channel/profile inspection matches the expected state.

## Retention and audit export

`go run ./apps/server/cmd/maintenance verify` checks references. `gc` conservatively retains every version/snapshot object and removes only unreferenced CAS files older than 24 hours. Run offline or under the same operator maintenance window; never delete objects directly. This policy prioritizes safe rollback over aggressive reclamation.

`audit-export` writes append-only audit records as NDJSON to stdout; direct this to the enterprise immutable log sink. Database triggers prevent ordinary updates/deletes, but a PostgreSQL superuser can bypass them; external retention is required for stronger tamper resistance.

## Migrations and upgrades

Migration 00001 initializes core data and append-only triggers; its down migration drops only the project tables, and is destructive. Migration 00002 adds cross-organization composite keys/guards; its down migration removes those guards without deleting application data. Back up before any down migration. A fresh up and 00002 down/up were executed on a separate test database. Upgrade server before clients; keep `/distribution/v1` backward compatible.

## Linux mounts

Install FUSE3. Run as an unprivileged host user where possible. For controlled test containers only, pass `/dev/fuse` and the mount capability; do not apply privileged mode to general Agent pods. Prefer a pre-mounted host volume. The delivered tests use a read-only mount, zero metadata TTL and direct file IO to preserve new-open visibility without reusing stale kernel file content. Old open handles retain their immutable Blob. Pin per task when task-wide consistency is required.

## Skiva naming and GitHub Pages

Configuration uses the `SKIVA_` environment prefix, the Go module is `skiva`, and the server binary is `bin/skiva-server`. Existing installations must migrate deployment variables, service names and client configuration/cache paths when upgrading from a pre-rename build. Preserve credentials and data; renaming a database is not required if `SKIVA_DATABASE_URL` points to its existing location. The mount CLI command remains `skills-mount`.

The documentation site is published at https://linghechen.github.io/skiva/ by `.github/workflows/pages.yml`. Only explicitly selected documentation components, content and styles enter the isolated static build. The full administration application still requires the Next.js and Go services. Repository Pages settings use GitHub Actions as the source.

Run `npm run build:docs --prefix apps/web` to export, then `npm run test:docs --prefix apps/web` to verify subpath assets, deep links, search, clipboard and mobile navigation on a static HTTP server.
