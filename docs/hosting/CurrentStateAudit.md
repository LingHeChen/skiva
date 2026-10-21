# Native Git hosting — Current state audit

Baseline: 5dd411d, 2026-10-21. This records source inspection before implementation.

| Area | Existing implementation | Incremental change |
| --- | --- | --- |
| Schema | migrations 00001/00002; repositories.remote_url NOT NULL; organization composite FKs | New additive migration, external default, nullable remote only for managed, immutable storage UUID, provisioning state, policy, ACL, PAT, events and observed refs |
| Source | platform/repository.go and git_transport.go validate remote URLs, pin DNS, load credential references | Keep external adapter; managed adapter resolves only DB-owned local storage IDs |
| Pipeline | platform/pipeline.go build fetches mirror then scans fixed SHA; unique repo/SHA/config/validator key | Select provider before fetch; reuse all discovery, validation, artifacts and release code |
| Events | webhook delivery deduplication and durable job_queue; minute polling | Controlled post-receive disk spool, DB event dispatcher and ref reconciliation |
| Identity | Browser sessions/IdP, organization roles; separate distribution credentials | Separate hashed Git PAT, expiry/revocation and repository membership; no delivery credential accepted |
| Git ingress | No native HTTP Git gateway or receive hooks | Restricted Smart HTTP CGI subprocess, explicit service authorization, controlled hooks and bounded resources |
| Console | console.tsx external repository form/detail | Managed creation, clone instructions, history/tree/diff, tokens, policies and membership |
| Documentation | Eight guides and static GitHub Pages workflow | Add managed hosting guide, update search/navigation and operational runbook |
| Backup | backup.sh dumps DB and entire SKIVA_DATA_DIR | Managed storage/spool remain inside data directory; integrity tooling and restore verification |
| Deployment | Nonprivileged server image, persistent /data volume | Three feature flags, public Git URL, proxy limits and dedicated transport settings |

## Implementation sequence and gates

1. Preserve baseline data and run existing regression. Add schema and provider compatibility.
2. Provision bare repositories with recoverable state; add PAT/ACL and Smart HTTP.
3. Validate pushes, spool accepted refs, reconcile, dispatch fixed-SHA builds.
4. Add console, OpenAPI/generated SDK, docs and deployment/backup tooling.
5. Run native Git CLI acceptance/negative tests plus existing Go, race, API, browser, static documentation and build checks.

Rollback disables managed creation/transport/auto-CI independently; do not drop columns or delete repository volumes. Published snapshots and Distribution API remain unchanged.

## Environment limits

Production enterprise IdP/TLS/proxy, production-architecture Linux FUSE and real Agent sandbox credentials are not supplied by this local workspace. Local automated evidence must not be described as production acceptance; external acceptance remains an explicit deployment gate.
