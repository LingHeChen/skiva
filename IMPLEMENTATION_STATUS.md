# Implementation status

Baseline: `docs/enterprise-skills-docs`, 2026-10-21. P0–P4 baseline implementation delivered; this file distinguishes verified local behavior from deployment acceptance.

| Phase | Implementation | Executed evidence | Remaining acceptance |
|---|---|---|---|
| P0 infrastructure/auth/contracts | Implemented: Go/Chi/pgx/sqlc, goose, RBAC/session/OIDC, OpenAPI TS generation, complete navigation | Go compile/race tests; Next production build; login/session/browser navigation; fresh migration + boundary migration rollback/reapply | None in local code regression; production IdP acceptance remains below |
| P1 Git CI/Registry | Implemented: HTTPS/SSH transport, pinned DNS target, secret references, provider signatures, reconciliation, leased queue, fixed SHA scanning, static policies, Registry/tree/diff | Real local HTTPS Git tests: E01–E06, E17; duplicate events/builds; validator upgrades; actual demo repository sync | External enterprise Git credentials/SSH known-host deployment acceptance |
| P2 CD/distribution | Implemented: immutable CAS/snapshots, duplicate-name rejection, optimistic channel CAS, atomic audit/history/outbox, profiles, scoped manifest/blob/range/SSE | PG integration: canary isolation, promotion, conflict, rollback, digest theft rejection, source-offline reads, damaged-blob denial, credential rotation/revocation, cross-org FK, cursor pagination, idempotency | None in local API/browser regression |
| P3 mount client | Implemented: Linux FUSE, atomic indexes, stable handles, SHA cache, SSE/poll, pinned/dynamic, persisted offline cache, lease/revocation, local control socket, bounded unreferenced-cache GC | Actual LinuxKit 6.10.14 arm64 FUSE mount/read/update/old-handle/read-only/unmount PASS; amd64 executable under LinuxKit emulation same test PASS; race tests PASS | Native x86_64 host and enterprise mount policy; combined Linux Agent/sandbox and in-memory caching acceptance |
| P4 administration/operations | Implemented: members/roles/disable, credentials, security thresholds, notifications, account, light/dark/mobile, metrics/OTLP/Grafana/alerts, backup/restore/integrity/GC tooling, CI | 4 browser navigation/error/delivery tests PASS; 29 live API response schemas PASS; backup/restore/integrity rehearsal PASS; Go vulnerability scan: no affected code paths; npm production audit: zero vulnerabilities | Actual enterprise IdP/MFA, production SLO and infrastructure fault matrix need deployment config; Docker image build blocked by slow registry layer download |

## Evidence locations

- `test-results/final-regression.txt`, `go-tests.txt`: Go unit/integration/race tests.
- `test-results/linux-fuse-arm64.txt`, `linux-fuse-amd64.txt`: actual kernel filesystem tests (amd64 emulated).
- `test-results/screenshots/`: all baseline pages, dark theme and mobile navigation.
- `test-results/benchmarks.txt`: measured manifest benchmark, Darwin arm64 Apple M4; not a service SLO.
- `test-results/govulncheck.txt`: latest Go vulnerability result (Go 1.26.10).
- `tests/e2e/`: repeatable browser scenarios.

## Boundaries

- macOS/Windows native mounting remains the explicitly separate future milestone from the source docs.
- No percentage rollout, arbitrary script CI, remote writes, online editor or billing is implemented (out of baseline).
- Cached offline access cannot provide instantaneous offline revocation. Profiles explicitly choose a policy.
- Workload credentials are shown once and stored only as hashes. Idempotent replay never re-displays the token; rotate if the first response was lost.
- Codex 0.163.0, Claude Code 2.1.236 and OpenCode 1.19.3 host runtime discovery passed without model calls. Native x86_64 and combined Linux Agent/cache acceptance remain external.
- Lists use cursor APIs and 20-row UI pagination; the UI currently collects cursor pages before local filtering, so very large organizations should qualify memory/latency under their workload.
- Pipeline discover/validate/artifact steps share one static scan interval; their displayed times overlap and are not additive.
- Docker source build was attempted but registry base-layer download did not complete; Go and Next production builds passed independently.

## Native Git hosting increment — 2026-10-21

Managed/external source adaptation, additive migration 00003, recoverable bare provisioning, native Smart HTTPS, scoped PAT/repository ACL, controlled receive hooks, durable ref events with reflog reconciliation, console and ninth documentation guide are implemented. Existing Pipeline/Registry/Release/Distribution are reused. Git hosting flags default off.

Local evidence: native Git CLI HTTPS clone/fetch/push and policy/ACL negative tests; Go race regression; 7 browser scenarios; 31 live API contract checks; static docs browser; Linux ARM64 FUSE; isolated DB/bare/CAS restore followed by Git push, fixed-SHA build, Canary release, Profile and verified manifest/blob reads. See `docs/hosting/ACCEPTANCE.md` for the exact coverage and production gates. “No remote writes” above describes the original delivery client: managed Git now accepts source writes, Distribution remains read-only.
