# Managed Git acceptance record

English · [简体中文](ACCEPTANCE.zh-CN.md)

2026-10-21. Implementation is incremental; production rollout remains gated by the target environment.

| Gate | Executed local evidence |
| --- | --- |
| M0 baseline | Original Go race tests passed; local DB and full data volume backed up before migration |
| M1 compatibility | Migration 00003 applied forward to populated application and test databases; previous external records retained; old Go/API/browser delivery regressions pass |
| M2 provisioning | Managed create, idempotent replay, failed filesystem provisioning retry, replay after atomic rename, soft-delete source preservation, source conversion rejection |
| M3 transport | Native Git HTTPS clone/fetch/push using a trusted test CA; plain loopback only under explicit dev flag; anonymous, invalid/revoked/expired/session token, read scope, member-role downgrade and nonmember tests; protected main, force/delete, tags, atomic multi-ref rejection, unsafe symlink, oversized object and invalid path tests |
| M4 CI | Sequential A/B pushes recorded and fixed-SHA builds verified; repeated builds deduplicate; dropped spool recovered from refs/reflog; existing release CAS/rollback/client compatibility regression preserved |
| M5 console/docs | 7 browser scenarios, including managed creation, history/files/diff, token issue/hide/revoke, policy edit and mobile; nine documentation pages; static subpath navigation test |
| M6 local recovery | DB + full data backup restored to separate DB/directory; CAS digests and git fsck; restored clone/fetch/push → fixed-SHA build → Canary snapshot → Profile → authorized manifest/blob hash verification |
| Existing client | Linux ARM64 FUSE kernel tests pass; Go mount/protocol race tests pass |

Reproducible commands:

```bash
make test-db
make lint test build-server openapi-generate sqlc-generate
npm run build --prefix apps/web
SKIVA_MANAGED_GIT_ENABLED=true SKIVA_DEMO_E2E=1 make test-e2e
npm run build:docs --prefix apps/web
npm run test:docs --prefix apps/web
make contract-check verify-artifacts
./scripts/test-linux-fuse.sh arm64
# After restoring to an isolated server only:
SKIVA_RESTORE_API_URL=http://127.0.0.1:8082 python3 scripts/verify-managed-restore.py
```

Local logs are retained under ignored `test-results/hosting-*`; test implementations are committed. Docker builds pin the Debian Git package and run as UID 10001. The CI workflow includes a fresh Docker build; local registry download progress must not be treated as a successful image build.

## Deployment gates still requiring environment input

- Enterprise IdP/MFA, actual HTTPS certificates, trusted proxy routing and blocked direct backend access.
- Production Linux architecture with real Agent sandbox, skill discovery and task-local cache behavior.
- Expected repository/size/concurrency load, measured SLOs, disk-full/read-only/corrupt volume, network interruption, DB outage and process-kill tests in preproduction.
- Multi-node hosting is not supported; the POSIX data volume is single-writer. Server, Git subprocesses and worker share a nonprivileged service identity; independent gateway UID/container isolation requires deployment qualification.
- Managed source physical GC is deliberately absent. Soft deletion reserves the logical name and retains source/history until an operator-approved retention procedure exists.
- Ref reconciliation reads bounded reflogs (8 MiB per file). Keep regular backups; do not expire reflogs before events are processed. Default Git response limit is 32 MiB. These are explicit first-release capacity limits, not production throughput guarantees.

Rollback: disable hosting/write/auto-CI flags; retain new columns/tables and source volume. Migration Down refuses destructive rollback. Existing Distribution and published snapshots remain served by unchanged protocol paths.
