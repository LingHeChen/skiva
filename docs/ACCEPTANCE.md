# Acceptance evidence

English · [简体中文](ACCEPTANCE.zh-CN.md)

Evidence is produced from the delivered source. Test mocks are used only for transport faults/identity-provider controls and are not presented as production features. The demo Registry was created through a real local HTTPS Git repository and worker.

## Environment

- Host: macOS arm64, Apple M4, Go 1.26.10, Node 24, Next.js 16.4.2.
- PostgreSQL 17 in Docker. Clean application database `skiva_local`; isolated integration database `skiva_test`; migration and restored databases separate.
- Linux mount test: Docker LinuxKit 6.10.14 aarch64, FUSE3, controlled `/dev/fuse` + SYS_ADMIN container. Native arm64 test binary passed. amd64 binary passed through the host's executable emulation; this is not native x86_64 hardware acceptance.

## Baseline cases

| ID | Automated evidence | Result |
|---|---|---|
| E01 | `TestE01E02E05E17TreeScan`, actual demo Git source | PASS single Skill discovery |
| E02 | same scan suite; demo with 2 Skills | PASS monorepo discovery |
| E03 | `TestIntegrationE03E04E06RealHTTPSGit` | PASS duplicate webhook/build deduplication |
| E04 | same HTTPS Git test | PASS new commit discovered without webhook |
| E05 | tree scan missing-reference case | PASS rule/path diagnostics |
| E06 | HTTPS Git validator-version test | PASS same SHA revalidated after rule upgrade |
| E07 | `TestIntegrationCanaryOfflineAndCorruption` | PASS canary does not modify stable |
| E08 | release integration + browser delivery | PASS generation/history/audit |
| E09 | concurrent release integration | PASS exactly one success / one 409 |
| E10 | release integration rollback | PASS historical pointer rollback without build |
| E11 | `TestE11DynamicHandles`, `TestLinuxFUSERealMount` | PASS actual old/new file handles |
| E12 | `TestE12Pinned` | PASS pinned unchanged until explicit repin |
| E13 | `TestE13Offline`, `TestCacheRestartAndCorruption` | PASS cached/deny policies, restart and persistent revoke |
| E14 | API and VFS revocation tests | PASS denied online requests and old-handle authorization |
| E15 | canary/offline test soft-deletes source | PASS published content available without Git |
| E16 | CAS and distribution corruption tests | PASS invalid bytes rejected and promotion blocked |
| E17 | unsafe paths, special inode, secrets/limits tests | PASS traversal and symlink rejection |
| E18 | `TestIntegrationRBACOrganizationsPaginationAndIdempotency` | PASS backend RBAC and cross-org DB constraints |
| E19 | Playwright admin suite | PASS full navigation, light/dark/mobile, retry, permission and empty states |
| E20 | API and browser delivery suites | PASS register/rotate/revoke with one-time token and audit |

Additional checks: OIDC Authorization Code + PKCE with signed test IdP and wrong-audience rejection; production local-login denial; keyset pagination; transactional idempotency; Range responses; immutable audit trigger; canonical manifest hashing and file/directory conflict rejection; concurrent VFS reads/refresh under the race detector; read-only kernel mount and unmount.

## Executed commands

```bash
make lint test build-server build-mount openapi-generate sqlc-generate
npm run build --prefix apps/web
cd apps/web && SKIVA_DEMO_E2E=1 npx playwright test
GOTOOLCHAIN=go1.26.10 go run golang.org/x/vuln/cmd/govulncheck@latest ./apps/server/... ./apps/mount/... ./packages/...
npm audit --prefix apps/web --omit=dev --audit-level=high --registry=https://registry.npmjs.org
./scripts/test-linux-fuse.sh arm64
./scripts/test-linux-fuse.sh amd64
SKIVA_ADMIN_PASSWORD=... .data/validation-venv/bin/python scripts/contract-check.py
```

- Go unit/integration/race suite passed, including partial Profile PATCH preserving fields and audited before/after state.
- Fixed Manifest golden fixture passed canonical-byte/hash checks and the published JSON Schema.
- TypeScript typecheck, ESLint and Go vet passed.
- Next.js production build passed.
- Four Playwright scenarios passed, including a real Git→release→canary→profile→client lifecycle.
- 29 live API responses validated against generated OpenAPI 3.1 response schemas.
- Go vulnerability scan: no affected code paths; one non-called vulnerability in a required module was reported by the scanner. Production npm audit: zero vulnerabilities.
- Fresh migrations and migration 00002 rollback/reapply passed on a separate database.
- Backup checksums, restoration into a fresh database/data directory, and integrity check of all 3 content-deduplicated referenced objects passed.

## Performance measurements

`test-results/benchmarks.txt` records the measured environment and results for 1/100/1000-Skill manifest canonicalization and 10/100 concurrent cached-open callers. These are microbenchmarks (3-byte cached fixture for opens), not network throughput, representative large-file latency or a production availability SLO. Full service load/SLO qualification belongs to the actual deployment capacity plan.

## Agent evidence

`agent-link.py` validated project search-path directory reads for Codex, Claude Code and OpenCode. Real Codex CLI 0.163.0 app-server `skills/list` discovered a test Skill through a project symlink and refreshed changed metadata via `forceReload`. Claude Code 2.1.236 initialization metadata discovered the same project Skill. OpenCode 1.19.3 `debug skill --pure` also discovered the project symlink Skill. None of these checks invoked a model. These host discovery tests and the Linux FUSE tests were executed separately; a combined Linux Agent/sandbox acceptance run remains deployment-specific.

## External acceptance still required

- Enterprise IdP configuration/MFA and real SSH/Git provider credentials.
- Native x86_64 host matrix, target kernels/container policies and actual Linux Agent sandbox discovery/loaded-context behavior.
- Full fault-injection environment for PostgreSQL primary failover, host disk exhaustion and production network/DNS policy.
- Production load, availability and recovery-time objectives; no unmeasured SLO is claimed.
- The server Docker image and migration command were subsequently verified locally; actual deployment TLS, enterprise IdP and alert delivery still require environment acceptance.
- Native macOS/Windows mounting is not implemented; the mount client requires Linux FUSE.

Screenshots/logs are in ignored `test-results/` because they can contain transient test identities and one-time credential responses in failure traces.

## Functional boundaries

- Managed Git accepts source writes; the distribution client and its mounted files remain read-only. See [managed Git acceptance](hosting/ACCEPTANCE.md).
- Percentage rollouts, arbitrary-script CI, an online editor and billing are not implemented.
- Offline cached access cannot provide immediate revocation while disconnected. Profiles must explicitly choose an offline policy.
- Workload credentials are shown only once and stored as hashes. Idempotent replay does not display them again; rotate lost credentials.
- List pages collect cursor pages before local filtering and pagination. Large registries require workload-specific memory and latency qualification.
- Pipeline discovery, validation and artifact steps share a static scan interval; displayed durations overlap and must not be added together.

## Local Pydantic AI pilot

A Pydantic AI agent using real model calls read a managed Git Skill through an actual ARM64 Linux FUSE mount. Two local runs covered initial content, dynamic updates, pinned content, rollback and credential revocation. The model ran on the macOS host and its tool read the container mount; this does not qualify every Agent sandbox or long-lived context cache. The repeatable example and configuration are in [examples/pydantic-agent](../examples/pydantic-agent/README.md).

The single-host preproduction Compose template, file-backed server secrets and server migration command are available in [deployments/preproduction](../deployments/preproduction/README.md). Local verification does not replace production load, recovery and identity-provider acceptance.
